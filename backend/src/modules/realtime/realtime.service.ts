import type { Audience, EventBus } from "@shared/events/event-bus.js";
import type { ConversationEventKind, RealtimeNotifier } from "@shared/ports/realtime.js";
import { idToString } from "@shared/utils/ids.js";
import type { ConversationSnapshot, ConversationSnapshots } from "./realtime.types.js";

const EVENT_NAMES: Record<ConversationEventKind, string> = {
  created: "conversation.created",
  updated: "conversation.updated",
  assigned: "conversation.assigned",
  transferred: "conversation.transferred",
  status_changed: "conversation.status_changed",
};

/**
 * Turns committed changes into audience-targeted events on the bus. Holds no business rules: who may see what is
 * decided by the shared access policy, evaluated per socket by the gateway.
 *
 * `conversations` is a function so the composition root can build this before the conversation service exists
 * (the conversation service itself reports changes through this notifier).
 */
export class RealtimeService implements RealtimeNotifier {
  constructor(
    private readonly bus: EventBus,
    private readonly conversations: () => ConversationSnapshots,
  ) {}

  async messageCreated(
    message: { id: string; conversationId: string },
    options: { origin?: string; conversationUpdated?: boolean } = {},
  ) {
    const snapshot = await this.conversations().snapshot(BigInt(message.conversationId));
    if (!snapshot) return;
    const audience = conversationAudience(snapshot);
    await this.bus.publish({
      type: "message.new",
      payload: { message },
      audience,
      ...(options.origin ? { except: options.origin } : {}),
    });
    if (options.conversationUpdated) {
      await this.bus.publish({
        type: "conversation.updated",
        payload: { conversation: snapshot.conversation },
        audience,
      });
    }
  }

  async messageStatus(conversationId: bigint, messageIds: bigint[], status: "DELIVERED" | "READ") {
    if (messageIds.length === 0) return;
    const snapshot = await this.conversations().snapshot(conversationId);
    if (!snapshot) return;
    await this.bus.publish({
      type: "message.status",
      payload: { conversationId: idToString(conversationId), messageIds: messageIds.map(idToString), status },
      audience: conversationAudience(snapshot),
    });
  }

  async conversationEvent(
    conversationId: bigint,
    kind: ConversationEventKind,
    extra: Record<string, unknown> = {},
    alsoNotify: bigint[] = [],
  ) {
    const snapshot = await this.conversations().snapshot(conversationId);
    if (!snapshot) return;
    await this.bus.publish({
      type: EVENT_NAMES[kind],
      payload: { conversationId: idToString(conversationId), ...extra, conversation: snapshot.conversation },
      audience: conversationAudience(snapshot, alsoNotify.map(idToString)),
    });

    // A waiting or AI-handled conversation is visible to every agent. Once someone owns it, the others lose access
    // and must drop it from their inbox. They get no conversation data, only its id.
    if ((kind === "assigned" || kind === "transferred") && snapshot.audience.handoffStatus === "ASSIGNED") {
      await this.bus.publish({
        type: "conversation.hidden",
        payload: { conversationId: idToString(conversationId) },
        audience: { kind: "not_conversation", ...snapshot.audience },
      });
    }
  }

  async presenceChanged(userId: bigint, status: string) {
    await this.bus.publish({
      type: "presence.updated",
      payload: { userId: idToString(userId), status },
      audience: { kind: "dashboard" },
    });
  }

  async typing(conversationId: bigint, userId: bigint, active: boolean, origin?: string) {
    const snapshot = await this.conversations().snapshot(conversationId);
    if (!snapshot) return;
    await this.bus.publish({
      type: "typing",
      payload: { conversationId: idToString(conversationId), userId: idToString(userId), side: "agent", active },
      audience: conversationAudience(snapshot),
      ...(origin ? { except: origin } : {}),
    });
  }

  async readState(agentId: bigint, state: object) {
    await this.bus.publish({
      type: "conversation.read",
      payload: state,
      audience: { kind: "users", userIds: [idToString(agentId)] },
    });
  }

  async notificationRead(agentId: bigint, payload: object) {
    await this.bus.publish({
      type: "notification.read",
      payload,
      audience: { kind: "users", userIds: [idToString(agentId)] },
    });
  }

  async notification(agentId: bigint, notification: object) {
    await this.bus.publish({
      type: "notification.new",
      payload: { notification },
      audience: { kind: "users", userIds: [idToString(agentId)] },
    });
  }
}

function conversationAudience({ audience }: ConversationSnapshot, alsoUserIds: string[] = []): Audience {
  return { kind: "conversation", ...audience, alsoUserIds };
}
