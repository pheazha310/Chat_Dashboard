import { Readable } from "node:stream";
import { fromPartial } from "@total-typescript/shoehorn";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeRealtime } from "../../../__tests__/support/realtime.js";
import { uid } from "../../../__tests__/support/ids.js";
import type { AuthContext } from "@shared/auth/auth.types.js";
import { BadRequestError, ForbiddenError, NotFoundError } from "@shared/errors/AppError.js";
import type { Storage } from "@shared/storage/storage.js";
import type { MessageService } from "@modules/messages/message.service.js";
import type { AttachmentRepository } from "../attachment.repository.js";
import { AttachmentService, RangeNotSatisfiable } from "../attachment.service.js";

vi.mock("@config/logger.js", () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));

const repo = { findLive: vi.fn(), findAudioOfMessage: vi.fn(), list: vi.fn(), softDelete: vi.fn() };
const storage = { put: vi.fn(), stat: vi.fn(), open: vi.fn(), delete: vi.fn() };
const messages = { sendWithAttachment: vi.fn(), receiveFileFromCustomer: vi.fn() };
const access = { requireVisible: vi.fn(), requireForCustomer: vi.fn() };
const realtime = fakeRealtime();
const service = new AttachmentService(
  fromPartial<AttachmentRepository>(repo),
  fromPartial<Storage>(storage),
  fromPartial<MessageService>(messages),
  () => access,
  realtime,
);

const owner: AuthContext = { userId: uid(1), role: "AGENT" };
const other: AuthContext = { userId: uid(2), role: "AGENT" };
const supervisor: AuthContext = { userId: uid(9), role: "SUPERVISOR" };
const open = {
  id: uid(10),
  customerId: uid(100),
  status: "OPEN",
  handoffStatus: "ASSIGNED",
  assignedAgentId: uid(1),
  isArchived: false,
};
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const upload = { originalname: "scan.png", mimetype: "image/png", size: PNG.length, buffer: PNG };
const row = (patch = {}) => ({
  id: uid(60),
  conversationId: uid(10),
  uploadedByType: "AGENT",
  uploadedById: uid(1),
  storageKey: "conversations/x/y.png",
  fileName: "scan.png",
  mimeType: "image/png",
  fileSize: 10n,
  durationMs: null,
  waveform: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  messageAttachments: [{ messageId: uid(50) }],
  ...patch,
});

beforeEach(() => {
  vi.resetAllMocks();
  for (const mock of Object.values(realtime)) mock.mockResolvedValue(undefined);
  access.requireVisible.mockResolvedValue(open);
  access.requireForCustomer.mockResolvedValue(open);
  messages.receiveFileFromCustomer.mockResolvedValue({
    message: { id: uid(50), attachments: [{ id: uid(60) }] },
    created: true,
  });
  storage.put.mockResolvedValue(undefined);
  storage.delete.mockResolvedValue(undefined);
  messages.sendWithAttachment.mockResolvedValue({
    message: { id: uid(50), attachments: [{ id: uid(60) }] },
    created: true,
  });
});

describe("upload", () => {
  const fields = { conversationId: uid(10), clientId: "c1", text: undefined };

  it("stores the file under a server-generated key, then the message, then announces it", async () => {
    await service.upload(owner, fields, { ...upload, originalname: "../../evil name.png" });
    const key = storage.put.mock.calls[0]?.[0] as string;
    expect(key).toMatch(new RegExp(`^conversations/${uid(10)}/[0-9a-f-]{36}\\.png$`));
    expect(messages.sendWithAttachment).toHaveBeenCalledWith(
      owner,
      uid(10),
      expect.objectContaining({
        clientId: "c1",
        messageType: "IMAGE",
        attachment: expect.objectContaining({
          storageKey: key,
          fileName: "evil name.png",
          mimeType: "image/png",
          fileSize: PNG.length,
        }),
      }),
    );
    expect(realtime.messageEvent).toHaveBeenCalledWith(uid(10), "attachment.uploaded", { attachment: { id: uid(60) } });
  });

  it("stores a SHA-256 checksum of the bytes", async () => {
    await service.upload(owner, fields, upload);
    const arg = messages.sendWithAttachment.mock.calls[0]?.[2];
    expect(arg.attachment.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects before touching storage when there is no file, no permission or an invalid file", async () => {
    await expect(service.upload(owner, fields, undefined)).rejects.toBeInstanceOf(BadRequestError);
    access.requireVisible.mockResolvedValue({ ...open, assignedAgentId: uid(2) });
    await expect(service.upload(owner, fields, upload)).rejects.toBeInstanceOf(ForbiddenError);
    access.requireVisible.mockRejectedValue(new NotFoundError());
    await expect(service.upload(other, fields, upload)).rejects.toBeInstanceOf(NotFoundError);
    access.requireVisible.mockResolvedValue(open);
    await expect(service.upload(owner, fields, { ...upload, mimetype: "text/html" })).rejects.toBeInstanceOf(
      BadRequestError,
    );
    expect(storage.put).not.toHaveBeenCalled();
  });

  it("removes the stored file when saving the message fails", async () => {
    messages.sendWithAttachment.mockRejectedValue(new Error("database down"));
    await expect(service.upload(owner, fields, upload)).rejects.toThrow("database down");
    expect(storage.delete).toHaveBeenCalledWith(storage.put.mock.calls[0]?.[0]);
    expect(realtime.messageEvent).not.toHaveBeenCalled();
  });

  it("still reports the original error when the cleanup also fails", async () => {
    messages.sendWithAttachment.mockRejectedValue(new Error("database down"));
    storage.delete.mockRejectedValue(new Error("disk"));
    await expect(service.upload(owner, fields, upload)).rejects.toThrow("database down");
  });

  it("discards the duplicate file on a retry and announces nothing", async () => {
    messages.sendWithAttachment.mockResolvedValue({ message: { id: uid(50), attachments: [] }, created: false });
    await expect(service.upload(owner, fields, upload)).resolves.toMatchObject({ created: false });
    expect(storage.delete).toHaveBeenCalledWith(storage.put.mock.calls[0]?.[0]);
    expect(realtime.messageEvent).not.toHaveBeenCalled();
  });
});

describe("voice messages", () => {
  const webm = {
    originalname: "voice.webm",
    mimetype: "audio/webm;codecs=opus",
    size: 6,
    buffer: Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0]),
  };

  it("stores a VOICE message with duration and waveform", async () => {
    await service.uploadVoice(owner, uid(10), { clientId: "v1", durationMs: 4200, waveform: [1, 2, 3] }, webm);
    expect(messages.sendWithAttachment).toHaveBeenCalledWith(
      owner,
      uid(10),
      expect.objectContaining({
        messageType: "VOICE",
        preview: "Voice message",
        attachment: expect.objectContaining({ mimeType: "audio/webm", durationMs: 4200, waveform: [1, 2, 3] }),
      }),
    );
  });

  it("refuses a recording that is not audio", async () => {
    await expect(service.uploadVoice(owner, uid(10), { clientId: "v1" }, upload)).rejects.toThrow(/audio/);
    expect(storage.put).not.toHaveBeenCalled();
  });
});

describe("download", () => {
  beforeEach(() => {
    repo.findLive.mockResolvedValue(row());
    storage.stat.mockResolvedValue({ size: 100 });
    storage.open.mockReturnValue(Readable.from(["x"]));
  });

  it("streams the whole file after checking access to its conversation", async () => {
    const file = await service.download(owner, uid(60), { inline: false });
    expect(access.requireVisible).toHaveBeenCalledWith(owner, uid(10));
    expect(file).toMatchObject({ status: 200, size: 100, mimeType: "image/png", range: null, inline: false });
    expect(storage.open).toHaveBeenCalledWith("conversations/x/y.png", undefined);
  });

  it("hides a file from someone who cannot see its conversation", async () => {
    access.requireVisible.mockRejectedValue(new NotFoundError());
    await expect(service.download(other, uid(60), { inline: false })).rejects.toBeInstanceOf(NotFoundError);
    expect(storage.open).not.toHaveBeenCalled();
  });

  it("treats deleted, unknown and missing-on-disk files as not found", async () => {
    repo.findLive.mockResolvedValue(null);
    await expect(service.download(owner, uid(60), { inline: false })).rejects.toBeInstanceOf(NotFoundError);
    repo.findLive.mockResolvedValue(row());
    storage.stat.mockResolvedValue(null);
    await expect(service.download(owner, uid(60), { inline: false })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("serves a byte range as 206 and refuses one past the end", async () => {
    const part = await service.download(owner, uid(60), { inline: true, range: "bytes=10-19" });
    expect(part).toMatchObject({ status: 206, range: { start: 10, end: 19 }, inline: true });
    expect(storage.open).toHaveBeenCalledWith("conversations/x/y.png", { start: 10, end: 19 });
    await expect(service.download(owner, uid(60), { inline: true, range: "bytes=500-" })).rejects.toBeInstanceOf(
      RangeNotSatisfiable,
    );
  });

  it("only shows images, audio and video inline", async () => {
    repo.findLive.mockResolvedValue(row({ mimeType: "application/pdf", fileName: "a.pdf" }));
    expect((await service.download(owner, uid(60), { inline: true })).inline).toBe(false);
    repo.findLive.mockResolvedValue(row({ mimeType: "audio/ogg", fileName: "a.ogg" }));
    expect((await service.download(owner, uid(60), { inline: true })).inline).toBe(true);
  });

  it("plays the audio of a message", async () => {
    repo.findAudioOfMessage.mockResolvedValue(row({ mimeType: "audio/ogg" }));
    await expect(service.messageAudio(owner, uid(50), {})).resolves.toMatchObject({ inline: true });
    repo.findAudioOfMessage.mockResolvedValue(null);
    await expect(service.messageAudio(owner, uid(50), {})).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("remove", () => {
  beforeEach(() => {
    repo.findLive.mockResolvedValue(row());
    repo.softDelete.mockResolvedValue(true);
  });

  it("soft-deletes, removes the bytes and announces it", async () => {
    await service.remove(owner, uid(60));
    expect(repo.softDelete).toHaveBeenCalledWith(uid(60));
    expect(storage.delete).toHaveBeenCalledWith("conversations/x/y.png");
    expect(realtime.messageEvent).toHaveBeenCalledWith(uid(10), "attachment.deleted", {
      id: uid(60),
      conversationId: uid(10),
      messageId: uid(50),
    });
  });

  it("allows supervisors but not other agents, and loses a race gracefully", async () => {
    await expect(service.remove(supervisor, uid(60))).resolves.toBeTruthy();
    await expect(service.remove(other, uid(60))).rejects.toBeInstanceOf(ForbiddenError);
    repo.softDelete.mockResolvedValue(false);
    await expect(service.remove(owner, uid(60))).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("customer uploads", () => {
  const customer = uid(100);
  const fields = { clientId: "c1", text: undefined };

  it("stores the file, then a CUSTOMER message, and announces the attachment", async () => {
    await service.uploadFromCustomer(customer, uid(10), fields, upload);
    expect(access.requireForCustomer).toHaveBeenCalledWith(customer, uid(10));
    expect(access.requireVisible).not.toHaveBeenCalled();
    expect(messages.sendWithAttachment).not.toHaveBeenCalled();
    expect(messages.receiveFileFromCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: customer, conversationId: uid(10), clientId: "c1", messageType: "IMAGE" }),
    );
    expect(realtime.messageEvent).toHaveBeenCalledWith(uid(10), "attachment.uploaded", { attachment: { id: uid(60) } });
  });

  it("sends a voice message with its duration", async () => {
    const audio = {
      originalname: "v.webm",
      mimetype: "audio/webm",
      size: 4,
      buffer: Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
    };
    await service.uploadVoiceFromCustomer(customer, uid(10), { clientId: "v1", durationMs: 1500 }, audio);
    expect(messages.receiveFileFromCustomer).toHaveBeenCalledWith(
      expect.objectContaining({
        messageType: "VOICE",
        preview: "Voice message",
        attachment: expect.objectContaining({ durationMs: 1500 }),
      }),
    );
  });

  it("does not store anything for a conversation that is not theirs, or without a file", async () => {
    access.requireForCustomer.mockRejectedValue(new NotFoundError());
    await expect(service.uploadFromCustomer(customer, uid(10), fields, upload)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.uploadFromCustomer(customer, uid(10), fields, undefined)).rejects.toBeInstanceOf(
      BadRequestError,
    );
    expect(storage.put).not.toHaveBeenCalled();
  });

  it("discards the stored file when the customer is refused (blocked) or it is a retry", async () => {
    messages.receiveFileFromCustomer.mockRejectedValue(new ForbiddenError("This customer is blocked"));
    await expect(service.uploadFromCustomer(customer, uid(10), fields, upload)).rejects.toBeInstanceOf(ForbiddenError);
    expect(storage.delete).toHaveBeenCalledWith(storage.put.mock.calls[0]?.[0]);
    storage.delete.mockClear();
    messages.receiveFileFromCustomer.mockResolvedValue({ message: { id: uid(50), attachments: [] }, created: false });
    await service.uploadFromCustomer(customer, uid(10), fields, upload);
    expect(storage.delete).toHaveBeenCalledTimes(1);
  });

  it("downloads only files of the customer's own conversations", async () => {
    repo.findLive.mockResolvedValue(row());
    storage.stat.mockResolvedValue({ size: 10 });
    storage.open.mockReturnValue(Readable.from(["x"]));
    const file = await service.downloadForCustomer(customer, uid(60), { inline: false });
    expect(access.requireForCustomer).toHaveBeenCalledWith(customer, uid(10));
    expect(file.status).toBe(200);

    access.requireForCustomer.mockRejectedValue(new NotFoundError());
    await expect(service.downloadForCustomer(uid(999), uid(60), { inline: false })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    repo.findLive.mockResolvedValue(null);
    await expect(service.downloadForCustomer(customer, uid(61), { inline: false })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
