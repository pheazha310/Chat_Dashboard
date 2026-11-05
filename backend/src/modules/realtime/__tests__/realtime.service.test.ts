import { describe, expect, it, vi } from "vitest";
import type { BusEvent, EventBus } from "@shared/events/event-bus.js";
import { RealtimeService } from "../realtime.service.js";
import type { ConversationSnapshot } from "../realtime.types.js";

const snapshot = (handoffStatus: string, assignedAgentId: string | null): ConversationSnapshot => ({
  conversation: { id: "10", handoffStatus, assignedAgentId } as ConversationSnapshot["conversation"],
  audience: { handoffStatus, assignedAgentId, viewerIds: ["4"] },
});

function setup(found: ConversationSnapshot | null) {
  const published: BusEvent[] = [];
  const bus: EventBus = { publish: vi.fn(async (e) => void published.push(e)), subscribe: vi.fn(), close: vi.fn() };
  const service = new RealtimeService(bus, () => ({ snapshot: vi.fn().mockResolvedValue(found) }));
  return { service, published };
}

describe("RealtimeService", () => {
  it("publishes a new message to the conversation audience, skipping the origin socket", async () => {
    const { service, published } = setup(snapshot("ASSIGNED", "1"));
    await service.messageCreated({ id: "5", conversationId: "10" }, { origin: "conn-1", conversationUpdated: true });
    expect(published.map((e) => e.type)).toEqual(["message.new", "conversation.updated"]);
    expect(published[0]).toMatchObject({
      payload: { message: { id: "5" } },
      except: "conn-1",
      audience: {
        kind: "conversation",
        handoffStatus: "ASSIGNED",
        assignedAgentId: "1",
        viewerIds: ["4"],
        alsoUserIds: [],
      },
    });
    expect(published[1]?.except).toBeUndefined(); // the preview change goes to every session, including the sender's
  });

  it("does nothing for a conversation that no longer exists", async () => {
    const { service, published } = setup(null);
    await service.messageCreated({ id: "5", conversationId: "10" });
    await service.conversationEvent(10n, "updated");
    await service.typing(10n, 1n, true);
    expect(published).toEqual([]);
  });

  it("names the previous owner so they learn the chat moved, and tells everyone else who lost access", async () => {
    const { service, published } = setup(snapshot("ASSIGNED", "2"));
    await service.conversationEvent(10n, "transferred", { agentId: "2" }, [1n]);
    expect(published[0]).toMatchObject({
      type: "conversation.transferred",
      payload: { conversationId: "10", agentId: "2" },
      audience: { kind: "conversation", alsoUserIds: ["1"] },
    });
    expect(published[1]).toMatchObject({
      type: "conversation.hidden",
      payload: { conversationId: "10" },
      audience: { kind: "not_conversation", assignedAgentId: "2" },
    });
  });

  it("sends no hidden event when the conversation did not become owned", async () => {
    const { service, published } = setup(snapshot("NEEDS_HUMAN", null));
    await service.conversationEvent(10n, "updated");
    await service.conversationEvent(10n, "status_changed", { from: "OPEN", to: "RESOLVED" });
    expect(published.map((e) => e.type)).toEqual(["conversation.updated", "conversation.status_changed"]);
  });

  it("targets read state and notifications at one user, presence at everyone, status updates at the audience", async () => {
    const { service, published } = setup(snapshot("NONE", null));
    await service.readState(1n, { conversationId: "10", unreadCount: 0 });
    await service.notification(1n, { id: "1" });
    await service.presenceChanged(1n, "BUSY");
    await service.messageStatus(10n, [5n, 6n], "READ");
    await service.messageStatus(10n, [], "READ");
    expect(published.map((e) => [e.type, e.audience.kind])).toEqual([
      ["conversation.read", "users"],
      ["notification.new", "users"],
      ["presence.updated", "dashboard"],
      ["message.status", "conversation"],
    ]);
    expect(published[3]?.payload).toEqual({ conversationId: "10", messageIds: ["5", "6"], status: "READ" });
  });
});
