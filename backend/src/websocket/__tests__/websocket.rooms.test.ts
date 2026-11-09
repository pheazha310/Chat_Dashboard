import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@shared/auth/auth.types.js";
import type { Audience } from "@shared/events/event-bus.js";
import { canReceive, ConnectionRegistry, type Connection } from "../websocket.rooms.js";
import { uid } from "../../__tests__/support/ids.js";

const agent1: AuthContext = { userId: uid(1), role: "AGENT" };
const agent2: AuthContext = { userId: uid(2), role: "AGENT" };
const supervisor: AuthContext = { userId: uid(9), role: "SUPERVISOR" };

const conversation = (patch: Partial<Extract<Audience, { kind: "conversation" }>> = {}): Audience => ({
  kind: "conversation",
  handoffStatus: "NEEDS_HUMAN",
  assignedAgentId: null,
  viewerIds: [],
  alsoUserIds: [],
  ...patch,
});
const assignedTo1 = conversation({ handoffStatus: "ASSIGNED", assignedAgentId: uid(1) });

describe("canReceive", () => {
  it("delivers dashboard events to everyone and user events only to the named users", () => {
    expect(canReceive({ kind: "dashboard" }, agent2)).toBe(true);
    expect(canReceive({ kind: "users", userIds: [uid(1)] }, agent1)).toBe(true);
    expect(canReceive({ kind: "users", userIds: [uid(1)] }, agent2)).toBe(false);
    expect(canReceive({ kind: "users", userIds: [uid(1)] }, supervisor)).toBe(false); // supervisors do not read others' notifications
  });

  it("follows the REST visibility rule for conversation events", () => {
    expect(canReceive(conversation(), agent2)).toBe(true); // waiting in the queue
    expect(canReceive(conversation({ handoffStatus: "NONE" }), agent2)).toBe(true); // AI-handled
    expect(canReceive(assignedTo1, agent1)).toBe(true);
    expect(canReceive(assignedTo1, agent2)).toBe(false);
    expect(canReceive(assignedTo1, supervisor)).toBe(true);
  });

  it("lets viewers in and tells users who just lost access", () => {
    expect(canReceive({ ...assignedTo1, viewerIds: [uid(2)] } as Audience, agent2)).toBe(true);
    expect(canReceive({ ...assignedTo1, alsoUserIds: [uid(2)] } as Audience, agent2)).toBe(true);
  });

  it("not_conversation reaches exactly the sockets that cannot see the conversation", () => {
    const hidden: Audience = {
      kind: "not_conversation",
      handoffStatus: "ASSIGNED",
      assignedAgentId: uid(1),
      viewerIds: [],
    };
    expect(canReceive(hidden, agent1)).toBe(false);
    expect(canReceive(hidden, supervisor)).toBe(false);
    expect(canReceive(hidden, agent2)).toBe(true);
  });
});

describe("ConnectionRegistry.deliver", () => {
  const connection = (id: string, auth?: AuthContext) => {
    const socket = { OPEN: 1, readyState: 1, bufferedAmount: 0, send: vi.fn(), terminate: vi.fn() };
    return { id, auth, socket, typing: new Map(), queue: Promise.resolve() } as unknown as Connection & {
      socket: { send: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn>; bufferedAmount: number };
    };
  };

  it("sends only to authenticated, allowed sockets and skips the origin", () => {
    const registry = new ConnectionRegistry();
    const owner = connection("a", agent1);
    const originTab = connection("b", agent1);
    const stranger = connection("c", agent2);
    const anonymous = connection("d");
    [owner, originTab, stranger, anonymous].forEach((c) => registry.add(c));

    registry.deliver({ type: "message.new", payload: { message: { id: uid(1) } }, audience: assignedTo1, except: "b" });

    expect(owner.socket.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "message.new", payload: { message: { id: uid(1) } } }),
    );
    expect(originTab.socket.send).not.toHaveBeenCalled();
    expect(stranger.socket.send).not.toHaveBeenCalled();
    expect(anonymous.socket.send).not.toHaveBeenCalled();
  });

  it("drops a client that stopped reading instead of buffering forever", () => {
    const registry = new ConnectionRegistry();
    const slow = connection("a", agent1);
    slow.socket.bufferedAmount = 10 * 1024 * 1024;
    registry.add(slow);
    registry.deliver({ type: "x", payload: {}, audience: { kind: "dashboard" } });
    expect(slow.socket.terminate).toHaveBeenCalled();
    expect(slow.socket.send).not.toHaveBeenCalled();
  });

  it("delivers a user-addressed event to every window of that user and to nobody else", () => {
    const registry = new ConnectionRegistry();
    const windowA = connection("a", agent1);
    const windowB = connection("b", agent1);
    const other = connection("c", agent2);
    [windowA, windowB, other].forEach((c) => registry.add(c));

    registry.deliver({
      type: "workspace.tab_opened",
      payload: { conversationId: uid(10) },
      audience: { kind: "users", userIds: [uid(1)] },
    });

    expect(windowA.socket.send).toHaveBeenCalledTimes(1);
    expect(windowB.socket.send).toHaveBeenCalledTimes(1);
    expect(other.socket.send).not.toHaveBeenCalled();
  });

  it("checks access per window: a conversation event reaches only the windows whose user may see it", () => {
    const registry = new ConnectionRegistry();
    const owner1 = connection("a", agent1);
    const owner2 = connection("b", agent1);
    const stranger = connection("c", agent2);
    [owner1, owner2, stranger].forEach((c) => registry.add(c));
    registry.deliver({ type: "conversation.updated", payload: {}, audience: assignedTo1 });
    expect(owner1.socket.send).toHaveBeenCalledTimes(1);
    expect(owner2.socket.send).toHaveBeenCalledTimes(1);
    expect(stranger.socket.send).not.toHaveBeenCalled();
  });
});
