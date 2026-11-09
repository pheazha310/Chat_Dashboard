import { describe, expect, it, vi } from "vitest";
import type { BusEvent, EventBus } from "@shared/events/event-bus.js";
import { RealtimeService } from "../realtime.service.js";
import type { ConversationSnapshot } from "../realtime.types.js";
import { uid } from "../../../__tests__/support/ids.js";

const snapshot = (handoffStatus: string, assignedAgentId: string | null): ConversationSnapshot => ({
  conversation: { id: uid(10), handoffStatus, assignedAgentId } as ConversationSnapshot["conversation"],
  audience: { handoffStatus, assignedAgentId, viewerIds: [uid(4)] },
});

function setup(found: ConversationSnapshot | null) {
  const published: BusEvent[] = [];
  const bus: EventBus = { publish: vi.fn(async (e) => void published.push(e)), subscribe: vi.fn(), close: vi.fn() };
  const service = new RealtimeService(bus, () => ({ snapshot: vi.fn().mockResolvedValue(found) }));
  return { service, published };
}

describe("RealtimeService", () => {
  it("publishes a new message to the conversation audience, skipping the origin socket", async () => {
    const { service, published } = setup(snapshot("ASSIGNED", uid(1)));
    await service.messageCreated(
      { id: uid(5), conversationId: uid(10) },
      { origin: "conn-1", conversationUpdated: true },
    );
    expect(published.map((e) => e.type)).toEqual(["message.new", "conversation.updated"]);
    expect(published[0]).toMatchObject({
      payload: { message: { id: uid(5) } },
      except: "conn-1",
      audience: {
        kind: "conversation",
        handoffStatus: "ASSIGNED",
        assignedAgentId: uid(1),
        viewerIds: [uid(4)],
        alsoUserIds: [],
      },
    });
    expect(published[1]?.except).toBeUndefined(); // the preview change goes to every session, including the sender's
  });

  it("does nothing for a conversation that no longer exists", async () => {
    const { service, published } = setup(null);
    await service.messageCreated({ id: uid(5), conversationId: uid(10) });
    await service.conversationEvent(uid(10), "updated");
    await service.typing(uid(10), uid(1), true);
    expect(published).toEqual([]);
  });

  it("names the previous owner so they learn the chat moved, and tells everyone else who lost access", async () => {
    const { service, published } = setup(snapshot("ASSIGNED", uid(2)));
    await service.conversationEvent(uid(10), "transferred", { agentId: uid(2) }, [uid(1)]);
    expect(published[0]).toMatchObject({
      type: "conversation.transferred",
      payload: { conversationId: uid(10), agentId: uid(2) },
      audience: { kind: "conversation", alsoUserIds: [uid(1)] },
    });
    expect(published[1]).toMatchObject({
      type: "conversation.hidden",
      payload: { conversationId: uid(10) },
      audience: { kind: "not_conversation", assignedAgentId: uid(2) },
    });
  });

  it("sends no hidden event when the conversation did not become owned", async () => {
    const { service, published } = setup(snapshot("NEEDS_HUMAN", null));
    await service.conversationEvent(uid(10), "updated");
    await service.conversationEvent(uid(10), "status_changed", { from: "OPEN", to: "RESOLVED" });
    expect(published.map((e) => e.type)).toEqual(["conversation.updated", "conversation.status_changed"]);
  });

  it("targets read state and notifications at one user, presence at everyone, status updates at the audience", async () => {
    const { service, published } = setup(snapshot("NONE", null));
    await service.readState(uid(1), { conversationId: "10", unreadCount: 0 });
    await service.notification(uid(1), { id: uid(1) });
    await service.presenceChanged(uid(1), "BUSY");
    await service.messageStatus(uid(10), [uid(5), uid(6)], "READ");
    await service.messageStatus(uid(10), [], "READ");
    expect(published.map((e) => [e.type, e.audience.kind])).toEqual([
      ["conversation.read", "users"],
      ["notification.new", "users"],
      ["presence.updated", "dashboard"],
      ["message.status", "conversation"],
    ]);
    expect(published[3]?.payload).toEqual({ conversationId: uid(10), messageIds: [uid(5), uid(6)], status: "READ" });
  });

  it("sends agent events to all sessions of that agent only", async () => {
    const { service, published } = setup(null);
    await service.agentEvent(uid(1), "workspace.tab_closed", { conversationId: uid(10) });
    expect(published).toEqual([
      {
        type: "workspace.tab_closed",
        payload: { conversationId: uid(10) },
        audience: { kind: "users", userIds: [uid(1)] },
      },
    ]);
  });
});
