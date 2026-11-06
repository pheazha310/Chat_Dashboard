import { fromPartial } from "@total-typescript/shoehorn";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeRealtime } from "../../../__tests__/support/realtime.js";
import { uid } from "../../../__tests__/support/ids.js";
import type { AuthContext } from "@shared/auth/auth.types.js";
import { ForbiddenError, NotFoundError, ServiceUnavailableError } from "@shared/errors/AppError.js";
import type { NotificationService } from "@modules/notifications/index.js";
import type { NoteRepository } from "../note.repository.js";
import { NoteService } from "../note.service.js";
import type { NoteRow } from "../note.types.js";

vi.mock("@config/logger.js", () => ({ logger: { warn: vi.fn() } }));

const repo = {
  inTransaction: vi.fn(),
  findLive: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  addCreatedActivity: vi.fn(),
  update: vi.fn(),
  softDelete: vi.fn(),
};
const access = { requireVisible: vi.fn() };
const directory = { source: "test", getAgents: vi.fn(), getCustomer: vi.fn() };
const notifications = { notifyAgent: vi.fn() };
const realtime = fakeRealtime();
const service = new NoteService(
  fromPartial<NoteRepository>(repo),
  () => access,
  directory,
  fromPartial<NotificationService>(notifications),
  realtime,
);

const author: AuthContext = { userId: uid(1), role: "AGENT" };
const other: AuthContext = { userId: uid(2), role: "AGENT" };
const supervisor: AuthContext = { userId: uid(9), role: "SUPERVISOR" };
const at = new Date("2026-01-01T00:00:00Z");

const note = (patch: Partial<NoteRow> = {}): NoteRow =>
  fromPartial<NoteRow>({
    id: uid(60),
    conversationId: uid(10),
    authorAgentId: uid(1),
    content: "call back tomorrow",
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
    noteMentions: [],
    ...patch,
  });
const mention = (id: string) => ({ id: `m-${id}`, noteId: uid(60), mentionedAgentId: id, createdAt: at });

beforeEach(() => {
  vi.resetAllMocks();
  for (const mock of Object.values(realtime)) mock.mockResolvedValue(undefined);
  repo.inTransaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(repo));
  repo.create.mockImplementation(async (d: { content: string; mentionedAgentIds: string[] }) =>
    note({ content: d.content, noteMentions: d.mentionedAgentIds.map(mention) }),
  );
  access.requireVisible.mockResolvedValue({});
  directory.getAgents.mockImplementation(async (ids: string[]) =>
    ids.map((id) => ({ id, name: `Agent ${id}`, avatarUrl: null })),
  );
  notifications.notifyAgent.mockResolvedValue(true);
});

describe("create", () => {
  it("stores the note with a timeline entry (without its text) and announces it", async () => {
    const dto = await service.create(author, uid(10), { text: "call back tomorrow", mentionedAgentIds: [] });
    expect(repo.create).toHaveBeenCalledWith({
      conversationId: uid(10),
      authorAgentId: uid(1),
      content: "call back tomorrow",
      mentionedAgentIds: [],
    });
    expect(repo.addCreatedActivity).toHaveBeenCalledWith(uid(10), uid(1), uid(60));
    expect(dto).toMatchObject({ authorAgentId: uid(1), permissions: { canEdit: true, canDelete: true } });
    expect(dto.author?.name).toBe(`Agent ${uid(1)}`);
    const payload = realtime.messageEvent.mock.calls[0]?.[2] as { note: Record<string, unknown> };
    expect(realtime.messageEvent.mock.calls[0]?.[1]).toBe("note.created");
    expect(payload.note).not.toHaveProperty("permissions"); // the sender's flags must not leak to other viewers
  });

  it("hides the note from people who cannot see the conversation", async () => {
    access.requireVisible.mockRejectedValue(new NotFoundError());
    await expect(service.create(other, uid(10), { text: "x", mentionedAgentIds: [] })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("notifies each mentioned agent once, ignoring duplicates and the author", async () => {
    await service.create(author, uid(10), { text: "see this", mentionedAgentIds: [uid(2), uid(2), uid(1), uid(3)] });
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ mentionedAgentIds: [uid(2), uid(3)] }));
    expect(notifications.notifyAgent.mock.calls.map(([n]) => n.agentId)).toEqual([uid(2), uid(3)]);
    expect(notifications.notifyAgent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "MENTION", conversationId: uid(10), body: "see this" }),
    );
    expect(realtime.agentEvent).toHaveBeenCalledWith(
      uid(2),
      "note.mentioned",
      expect.objectContaining({ noteId: uid(60), mentionedBy: uid(1) }),
    );
  });

  it("refuses unknown agents and agents who cannot open the conversation, and stores nothing", async () => {
    directory.getAgents.mockResolvedValue([{ id: uid(2), name: "B", avatarUrl: null }]);
    await expect(
      service.create(author, uid(10), { text: "x", mentionedAgentIds: [uid(2), uid(3)] }),
    ).rejects.toMatchObject({ status: 400, details: { agentIds: [uid(3)] } });

    directory.getAgents.mockImplementation(async (ids: string[]) =>
      ids.map((id) => ({ id, name: id, avatarUrl: null })),
    );
    access.requireVisible.mockImplementation(async (who: AuthContext) => {
      if (who.userId === uid(2)) throw new NotFoundError();
      return {};
    });
    await expect(service.create(author, uid(10), { text: "x", mentionedAgentIds: [uid(2)] })).rejects.toMatchObject({
      status: 400,
      details: { agentIds: [uid(2)] },
    });
    expect(access.requireVisible).toHaveBeenCalledWith({ userId: uid(2), role: "AGENT" }, uid(10));
    expect(repo.create).not.toHaveBeenCalled();
    expect(notifications.notifyAgent).not.toHaveBeenCalled();
  });

  it("reports an unreachable directory as 503", async () => {
    directory.getAgents.mockRejectedValue(new Error("down"));
    await expect(service.create(author, uid(10), { text: "x", mentionedAgentIds: [uid(2)] })).rejects.toBeInstanceOf(
      ServiceUnavailableError,
    );
  });

  it("still succeeds when a notification or the realtime push fails", async () => {
    notifications.notifyAgent.mockRejectedValue(new Error("db"));
    realtime.messageEvent.mockRejectedValue(new Error("redis"));
    realtime.agentEvent.mockRejectedValue(new Error("redis"));
    await expect(service.create(author, uid(10), { text: "x", mentionedAgentIds: [uid(2)] })).resolves.toBeTruthy();
  });
});

describe("list", () => {
  it("returns the caller's permissions per note", async () => {
    repo.list.mockResolvedValue({ items: [note(), note({ id: uid(61), authorAgentId: uid(2) })], total: 2 });
    const asAuthor = await service.list(author, uid(10), { page: 1, size: 25 });
    expect(asAuthor.items.map((n) => n.permissions)).toEqual([
      { canEdit: true, canDelete: true },
      { canEdit: false, canDelete: false },
    ]);
    const asBoss = await service.list(supervisor, uid(10), { page: 1, size: 25 });
    expect(asBoss.items.map((n) => n.permissions)).toEqual([
      { canEdit: false, canDelete: true },
      { canEdit: false, canDelete: true },
    ]);
    expect(asAuthor.meta).toMatchObject({ total: 2 });
  });

  it("does not list notes of a hidden conversation", async () => {
    access.requireVisible.mockRejectedValue(new NotFoundError());
    await expect(service.list(other, uid(10), { page: 1, size: 25 })).rejects.toBeInstanceOf(NotFoundError);
    expect(repo.list).not.toHaveBeenCalled();
  });
});

describe("update", () => {
  beforeEach(() => repo.findLive.mockResolvedValue(note({ noteMentions: [mention(uid(2))] })));

  it("lets only the author edit; a supervisor cannot", async () => {
    await expect(service.update(other, uid(60), { text: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.update(supervisor, uid(60), { text: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("treats a missing, deleted or hidden note as not found", async () => {
    repo.findLive.mockResolvedValue(null);
    await expect(service.update(author, uid(60), { text: "x" })).rejects.toBeInstanceOf(NotFoundError);
    repo.findLive.mockResolvedValue(note());
    access.requireVisible.mockRejectedValue(new NotFoundError());
    await expect(service.update(other, uid(60), { text: "x" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("notifies only newly added mentions and replaces the list", async () => {
    repo.update.mockResolvedValue(note({ content: "new", noteMentions: [mention(uid(3))] }));
    await service.update(author, uid(60), { text: "new", mentionedAgentIds: [uid(3)] });
    expect(repo.update).toHaveBeenCalledWith(uid(60), { content: "new", mentionedAgentIds: [uid(3)] });
    expect(notifications.notifyAgent.mock.calls.map(([n]) => n.agentId)).toEqual([uid(3)]);
    expect(realtime.messageEvent).toHaveBeenCalledWith(uid(10), "note.updated", expect.anything());
  });

  it("does nothing when nothing changed", async () => {
    await service.update(author, uid(60), { text: "call back tomorrow", mentionedAgentIds: [uid(2)] });
    expect(repo.update).not.toHaveBeenCalled();
    expect(realtime.messageEvent).not.toHaveBeenCalled();
  });

  it("does not re-notify agents who were already mentioned", async () => {
    repo.update.mockResolvedValue(note({ content: "edited", noteMentions: [mention(uid(2))] }));
    await service.update(author, uid(60), { text: "edited", mentionedAgentIds: [uid(2)] });
    expect(notifications.notifyAgent).not.toHaveBeenCalled();
  });

  it("reports a note deleted while editing as not found", async () => {
    repo.update.mockResolvedValue(null);
    await expect(service.update(author, uid(60), { text: "edited" })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("remove", () => {
  beforeEach(() => {
    repo.findLive.mockResolvedValue(note());
    repo.softDelete.mockResolvedValue(true);
  });

  it("lets the author or a supervisor delete, announces it, and refuses others", async () => {
    await expect(service.remove(author, uid(60))).resolves.toEqual({ id: uid(60), conversationId: uid(10) });
    expect(realtime.messageEvent).toHaveBeenCalledWith(uid(10), "note.deleted", {
      id: uid(60),
      conversationId: uid(10),
    });
    await expect(service.remove(supervisor, uid(60))).resolves.toBeTruthy();
    await expect(service.remove(other, uid(60))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("loses a race with another delete gracefully", async () => {
    repo.softDelete.mockResolvedValue(false);
    await expect(service.remove(author, uid(60))).rejects.toBeInstanceOf(NotFoundError);
  });
});
