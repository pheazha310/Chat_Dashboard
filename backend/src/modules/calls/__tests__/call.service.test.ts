import { createHmac } from "node:crypto";
import { fromPartial } from "@total-typescript/shoehorn";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeRealtime } from "../../../__tests__/support/realtime.js";
import { uid } from "../../../__tests__/support/ids.js";
import type { AuthContext } from "@shared/auth/auth.types.js";
import { ConflictError, ForbiddenError, NotFoundError } from "@shared/errors/AppError.js";
import type { CallRepository, CallRow } from "../call.repository.js";
import { CallService } from "../call.service.js";
import type { IceConfig } from "../call.types.js";

vi.mock("@config/logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

const repo = {
  inTransaction: vi.fn(),
  findById: vi.fn(),
  findOpen: vi.fn(),
  create: vi.fn(),
  list: vi.fn(),
  activate: vi.fn(),
  finish: vi.fn(),
  join: vi.fn(),
  claimUnanswered: vi.fn(),
  claimOverlong: vi.fn(),
  addActivity: vi.fn(),
};
const conversations = { requireVisible: vi.fn(), requireForCustomer: vi.fn() };
const notifications = { notifyAgent: vi.fn() };
const realtime = fakeRealtime();
const now = new Date("2030-01-01T10:00:00Z");
const ice: IceConfig = {
  stunUrls: ["stun:stun.example.com:3478"],
  turnUrls: ["turn:turn.example.com:3478"],
  turnSecret: "shared-secret",
  turnTtlSeconds: 3600,
};
const make = (config: IceConfig = ice) =>
  new CallService(
    fromPartial<CallRepository>(repo),
    () => conversations,
    notifications,
    realtime,
    { ringTimeoutMs: 45_000, maxDurationMs: 4 * 3_600_000 },
    config,
    () => now,
  );
const service = make();

const owner: AuthContext = { userId: uid(1), role: "AGENT" };
const other: AuthContext = { userId: uid(2), role: "AGENT" };
const supervisor: AuthContext = { userId: uid(9), role: "SUPERVISOR" };
const customerId = uid(100);
const state = (patch = {}) => ({
  id: uid(10),
  customerId,
  status: "OPEN",
  handoffStatus: "ASSIGNED",
  assignedAgentId: uid(1),
  isArchived: false,
  ...patch,
});

const participant = (type: string, id: string, joined: boolean, left = false) =>
  fromPartial<CallRow["callParticipants"][number]>({
    participantType: type,
    participantId: id,
    joinedAt: joined ? now : null,
    leftAt: left ? now : null,
  });
const row = (patch: Partial<CallRow> = {}) =>
  fromPartial<CallRow>({
    id: uid(50),
    conversationId: uid(10),
    callType: "AUDIO",
    initiatedByType: "AGENT",
    initiatedById: uid(1),
    status: "RINGING",
    startedAt: null,
    endedAt: null,
    createdAt: now,
    callParticipants: [participant("AGENT", uid(1), true), participant("CUSTOMER", customerId, false)],
    ...patch,
  });
const active = (patch: Partial<CallRow> = {}) =>
  row({
    status: "ACTIVE",
    startedAt: now,
    callParticipants: [participant("AGENT", uid(1), true), participant("CUSTOMER", customerId, true)],
    ...patch,
  });
const customerCall = (patch: Partial<CallRow> = {}) =>
  row({
    initiatedByType: "CUSTOMER",
    initiatedById: customerId,
    callParticipants: [participant("CUSTOMER", customerId, true)],
    ...patch,
  });

beforeEach(() => {
  vi.resetAllMocks();
  for (const mock of Object.values(realtime)) mock.mockResolvedValue(undefined);
  repo.inTransaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(repo));
  repo.findOpen.mockResolvedValue(null);
  repo.addActivity.mockResolvedValue(undefined);
  repo.activate.mockResolvedValue(true);
  repo.finish.mockResolvedValue(true);
  repo.join.mockResolvedValue(undefined);
  repo.claimUnanswered.mockResolvedValue([]);
  repo.claimOverlong.mockResolvedValue([]);
  notifications.notifyAgent.mockResolvedValue(true);
  conversations.requireVisible.mockResolvedValue(state());
  conversations.requireForCustomer.mockResolvedValue(state());
});

describe("start", () => {
  it("lets the owner call the customer, and rings the customer's channel only", async () => {
    repo.create.mockResolvedValue(row());
    const call = await service.start(owner, uid(10), { callType: "AUDIO" });

    expect(repo.create).toHaveBeenCalledWith({
      conversationId: uid(10),
      callType: "AUDIO",
      initiator: { type: "AGENT", id: uid(1) },
      callee: { type: "CUSTOMER", id: customerId },
    });
    expect(call).toMatchObject({
      status: "RINGING",
      permissions: { canCancel: true, canAccept: false, canEnd: false },
    });
    expect(realtime.agentEvent).toHaveBeenCalledWith(customerId, "call.incoming", expect.anything());
    expect(realtime.messageEvent).not.toHaveBeenCalled(); // no ringing for the other agents on an outgoing call
  });

  it("refuses everyone but the owner, a closed conversation, and a missing customer", async () => {
    for (const caller of [other, supervisor]) {
      await expect(service.start(caller, uid(10), { callType: "AUDIO" })).rejects.toBeInstanceOf(ForbiddenError);
    }
    conversations.requireVisible.mockResolvedValue(state({ status: "CLOSED" }));
    await expect(service.start(owner, uid(10), { callType: "AUDIO" })).rejects.toBeInstanceOf(ForbiddenError);
    conversations.requireVisible.mockResolvedValue(state({ customerId: null }));
    await expect(service.start(owner, uid(10), { callType: "AUDIO" })).rejects.toBeInstanceOf(ConflictError);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("answers 404 for a conversation the caller cannot see", async () => {
    conversations.requireVisible.mockRejectedValue(new NotFoundError("hidden"));
    await expect(service.start(other, uid(10), { callType: "AUDIO" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses a second call, whether found by the check or by the database index", async () => {
    repo.findOpen.mockResolvedValueOnce(row());
    await expect(service.start(owner, uid(10), { callType: "AUDIO" })).rejects.toBeInstanceOf(ConflictError);
    repo.create.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));
    await expect(service.start(owner, uid(10), { callType: "AUDIO" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("still succeeds when the realtime publish fails", async () => {
    repo.create.mockResolvedValue(row());
    realtime.agentEvent.mockRejectedValue(new Error("redis down"));
    await expect(service.start(owner, uid(10), { callType: "VIDEO" })).resolves.toMatchObject({ id: uid(50) });
  });
});

describe("answering", () => {
  it("lets only the customer answer a call an agent started", async () => {
    repo.findById.mockResolvedValue(row());
    await expect(service.accept(owner, uid(50))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.accept(supervisor, uid(50))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.decline(owner, uid(50))).rejects.toBeInstanceOf(ForbiddenError);
    expect(repo.activate).not.toHaveBeenCalled();
  });

  it("activates the call, joins the customer, and tells the conversation and the customer", async () => {
    repo.findById.mockResolvedValueOnce(row()).mockResolvedValueOnce(active());
    const call = await service.acceptByCustomer(customerId, uid(50));

    expect(call.status).toBe("ACTIVE");
    expect(repo.join).toHaveBeenCalledWith(uid(50), { type: "CUSTOMER", id: customerId });
    expect(realtime.messageEvent).toHaveBeenCalledWith(
      uid(10),
      "call.accepted",
      expect.objectContaining({ by: { type: "CUSTOMER", id: customerId } }),
    );
    expect(realtime.agentEvent).toHaveBeenCalledWith(customerId, "call.accepted", expect.anything());
  });

  it("rejects a customer who is not on this conversation", async () => {
    repo.findById.mockResolvedValue(row());
    conversations.requireForCustomer.mockRejectedValue(new NotFoundError("not theirs"));
    await expect(service.acceptByCustomer(uid(101), uid(50))).rejects.toBeInstanceOf(NotFoundError);
    expect(repo.activate).not.toHaveBeenCalled();
  });

  it("lets the owner, a supervisor, or anyone while unowned answer a customer's call, but not another agent", async () => {
    const answered = customerCall({
      status: "ACTIVE",
      callParticipants: [participant("CUSTOMER", customerId, true), participant("AGENT", uid(1), true)],
    });
    repo.findById.mockResolvedValue(customerCall());
    await expect(service.accept(other, uid(50))).rejects.toBeInstanceOf(ForbiddenError);

    repo.findById.mockResolvedValueOnce(customerCall()).mockResolvedValueOnce(answered);
    await expect(service.accept(owner, uid(50))).resolves.toMatchObject({ status: "ACTIVE" });
    expect(repo.join).toHaveBeenCalledWith(uid(50), { type: "AGENT", id: uid(1) });

    repo.findById.mockReset().mockResolvedValueOnce(customerCall()).mockResolvedValueOnce(answered);
    await expect(service.accept(supervisor, uid(50))).resolves.toBeDefined();

    conversations.requireVisible.mockResolvedValue(state({ assignedAgentId: null, handoffStatus: "NEEDS_HUMAN" }));
    repo.findById.mockReset().mockResolvedValueOnce(customerCall()).mockResolvedValueOnce(answered);
    await expect(service.accept(other, uid(50))).resolves.toBeDefined();
  });

  it("reports losing the race to answer as a conflict and writes nothing else", async () => {
    repo.findById.mockResolvedValue(customerCall());
    repo.activate.mockResolvedValue(false);
    await expect(service.accept(owner, uid(50))).rejects.toBeInstanceOf(ConflictError);
    expect(repo.join).not.toHaveBeenCalled();
    expect(repo.addActivity).not.toHaveBeenCalled();
    expect(realtime.messageEvent).not.toHaveBeenCalled();
  });

  it("refuses to answer a call that is no longer ringing", async () => {
    repo.findById.mockResolvedValue(customerCall({ status: "MISSED" }));
    await expect(service.accept(owner, uid(50))).rejects.toBeInstanceOf(ConflictError);
    await expect(service.decline(owner, uid(50))).rejects.toBeInstanceOf(ConflictError);
  });

  it("declines with the same people allowed", async () => {
    repo.findById
      .mockResolvedValueOnce(customerCall())
      .mockResolvedValueOnce(customerCall({ status: "DECLINED", endedAt: now }));
    await expect(service.decline(owner, uid(50))).resolves.toMatchObject({ status: "DECLINED" });
    expect(repo.finish).toHaveBeenCalledWith(uid(50), ["RINGING"], "DECLINED");
    expect(realtime.messageEvent).toHaveBeenCalledWith(uid(10), "call.declined", expect.anything());
  });
});

describe("cancelling and ending", () => {
  it("lets only the caller cancel, and only while ringing", async () => {
    repo.findById.mockResolvedValue(row());
    await expect(service.cancel(supervisor, uid(50))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.cancelByCustomer(customerId, uid(50))).rejects.toBeInstanceOf(ForbiddenError);

    repo.findById
      .mockReset()
      .mockResolvedValueOnce(row())
      .mockResolvedValueOnce(row({ status: "CANCELLED", endedAt: now }));
    await expect(service.cancel(owner, uid(50))).resolves.toMatchObject({ status: "CANCELLED" });
    expect(realtime.messageEvent).toHaveBeenCalledWith(
      uid(10),
      "call.ended",
      expect.objectContaining({ reason: "cancelled" }),
    );

    repo.findById.mockReset().mockResolvedValue(active());
    await expect(service.cancel(owner, uid(50))).rejects.toBeInstanceOf(ConflictError);
  });

  it("ends an answered call for a participant or a supervisor, and records the duration", async () => {
    const ended = active({ status: "ENDED", endedAt: new Date(now.getTime() + 95_000) });
    repo.findById.mockResolvedValueOnce(active()).mockResolvedValueOnce(ended);
    const call = await service.end(owner, uid(50));
    expect(call).toMatchObject({ status: "ENDED", durationSeconds: 95 });
    expect(repo.addActivity).toHaveBeenCalledWith(
      uid(10),
      { type: "AGENT", id: uid(1) },
      "Call ended",
      expect.objectContaining({ action: "ended", durationSeconds: "95" }),
    );

    repo.findById.mockReset().mockResolvedValue(active());
    await expect(service.end(other, uid(50))).rejects.toBeInstanceOf(ForbiddenError);
    repo.findById.mockReset().mockResolvedValueOnce(active()).mockResolvedValueOnce(ended);
    await expect(service.end(supervisor, uid(50))).resolves.toBeDefined();
  });

  it("will not end a ringing call or one that is already over, and reports a lost race", async () => {
    repo.findById.mockResolvedValue(row());
    await expect(service.end(owner, uid(50))).rejects.toBeInstanceOf(ConflictError);
    repo.findById.mockResolvedValue(active({ status: "ENDED" }));
    await expect(service.end(owner, uid(50))).rejects.toBeInstanceOf(ConflictError);
    repo.findById.mockResolvedValue(active());
    repo.finish.mockResolvedValue(false);
    await expect(service.end(owner, uid(50))).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("relay", () => {
  const sdp = { callId: uid(50), sdp: "v=0" };

  it("passes the caller's offer to the customer and the customer's answer back, naming the sender", async () => {
    repo.findById.mockResolvedValue(active());
    await service.relay({ type: "AGENT", auth: owner }, "offer", sdp);
    expect(realtime.agentEvent).toHaveBeenLastCalledWith(customerId, "call.offer", {
      callId: uid(50),
      from: { type: "AGENT", id: uid(1) },
      sdp: "v=0",
    });
    await service.relay({ type: "CUSTOMER", id: customerId }, "answer", sdp);
    expect(realtime.agentEvent).toHaveBeenLastCalledWith(uid(1), "call.answer", {
      callId: uid(50),
      from: { type: "CUSTOMER", id: customerId },
      sdp: "v=0",
    });
    await service.relay({ type: "CUSTOMER", id: customerId }, "ice_candidate", { callId: uid(50), candidate: null });
    expect(realtime.agentEvent).toHaveBeenLastCalledWith(
      uid(1),
      "call.ice_candidate",
      expect.objectContaining({ candidate: null }),
    );
  });

  it("keeps the roles straight: only the caller offers, only the callee answers", async () => {
    repo.findById.mockResolvedValue(active());
    await expect(service.relay({ type: "CUSTOMER", id: customerId }, "offer", sdp)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(service.relay({ type: "AGENT", auth: owner }, "answer", sdp)).rejects.toBeInstanceOf(ForbiddenError);
    expect(realtime.agentEvent).not.toHaveBeenCalled();
  });

  it("refuses anyone who is not a joined participant, including a supervisor and a customer of another chat", async () => {
    repo.findById.mockResolvedValue(active());
    for (const actor of [
      { type: "AGENT", auth: supervisor },
      { type: "AGENT", auth: other },
      { type: "CUSTOMER", id: uid(101) },
    ] as const) {
      await expect(service.relay(actor, "ice_candidate", { callId: uid(50), candidate: null })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
    expect(realtime.agentEvent).not.toHaveBeenCalled();
  });

  it("relays nothing before the call is answered or after it ended or when the other side left", async () => {
    repo.findById.mockResolvedValue(row());
    await expect(service.relay({ type: "AGENT", auth: owner }, "offer", sdp)).rejects.toBeInstanceOf(ConflictError);
    repo.findById.mockResolvedValue(active({ status: "ENDED" }));
    await expect(service.relay({ type: "AGENT", auth: owner }, "offer", sdp)).rejects.toBeInstanceOf(ConflictError);
    repo.findById.mockResolvedValue(
      active({
        callParticipants: [participant("AGENT", uid(1), true), participant("CUSTOMER", customerId, true, true)],
      }),
    );
    await expect(service.relay({ type: "AGENT", auth: owner }, "offer", sdp)).rejects.toBeInstanceOf(ConflictError);
    repo.findById.mockResolvedValue(null);
    await expect(service.relay({ type: "AGENT", auth: owner }, "offer", sdp)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("processDue", () => {
  it("marks unanswered calls missed and tells the owner about a customer's missed call only", async () => {
    repo.claimUnanswered.mockResolvedValue([customerCall({ id: uid(51) }), row()]);
    repo.claimOverlong.mockResolvedValue([active({ id: uid(52) })]);

    expect(await service.processDue(now)).toEqual({ missed: 2, ended: 1 });

    expect(repo.claimUnanswered).toHaveBeenCalledWith(new Date("2030-01-01T09:59:15Z"), 100);
    expect(repo.claimOverlong).toHaveBeenCalledWith(new Date("2030-01-01T06:00:00Z"), 100);
    expect(notifications.notifyAgent).toHaveBeenCalledTimes(1);
    expect(notifications.notifyAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: uid(1), type: "CALL", title: "Missed call", conversationId: uid(10) }),
    );
    expect(realtime.messageEvent).toHaveBeenCalledWith(
      uid(10),
      "call.ended",
      expect.objectContaining({ reason: "missed" }),
    );
    expect(realtime.messageEvent).toHaveBeenCalledWith(
      uid(10),
      "call.ended",
      expect.objectContaining({ reason: "timeout" }),
    );
  });

  it("survives a failing notification and does nothing when nothing is due", async () => {
    expect(await service.processDue(now)).toEqual({ missed: 0, ended: 0 });
    repo.claimUnanswered.mockResolvedValue([customerCall()]);
    notifications.notifyAgent.mockRejectedValue(new Error("down"));
    expect(await service.processDue(now)).toEqual({ missed: 1, ended: 0 });
  });
});

describe("iceServers", () => {
  it("gives each caller short-lived TURN credentials derived from the shared secret", () => {
    const { iceServers, ringTimeoutSeconds } = service.iceServers(owner);
    const expires = Math.floor(now.getTime() / 1000) + 3600;
    const username = `${expires}:${uid(1)}`;
    expect(ringTimeoutSeconds).toBe(45);
    expect(iceServers).toEqual([
      { urls: ["stun:stun.example.com:3478"] },
      {
        urls: ["turn:turn.example.com:3478"],
        username,
        credential: createHmac("sha1", "shared-secret").update(username).digest("base64"),
      },
    ]);
    expect(service.iceServers(other).iceServers[1]?.username).not.toBe(username);
  });

  it("falls back to a fixed account, and to nothing when nothing is configured", () => {
    const fixed = make({
      stunUrls: [],
      turnUrls: ["turn:t"],
      turnTtlSeconds: 60,
      turnUsername: "u",
      turnCredential: "p",
    });
    expect(fixed.iceServers(owner).iceServers).toEqual([{ urls: ["turn:t"], username: "u", credential: "p" }]);
    expect(make({ stunUrls: [], turnUrls: ["turn:t"], turnTtlSeconds: 60 }).iceServers(owner).iceServers).toEqual([]);
    expect(make({ stunUrls: [], turnUrls: [], turnTtlSeconds: 60 }).iceServers(owner).iceServers).toEqual([]);
  });
});
