import type { BackendFrame } from "@/shared/api/backend/types";
import type {
  BackendConversation,
  BackendMessage,
  BackendNote,
  BackendNotification,
  BackendReaction,
} from "@/shared/api/backend/types";
import {
  toAgent,
  toConversation,
  toDeliveryStatus,
  toMessage,
  toNotification,
  toNote,
  toReaction,
} from "@/shared/api/backend/mappers";
import type { ChatMessageDto } from "../protocol";

type Frame = { type: string; payload: unknown };

const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

/**
 * Translates between the frontend's event vocabulary (`ServerEventMap` / `ClientEventMap`, which the stores and the
 * mock server speak) and the backend gateway's (docs/websocket-events.md), so nothing above the socket changes.
 *
 * The only state it keeps is each conversation's unread count: the backend's conversation events omit it (it differs
 * per agent), while the UI's `conversation.updated` carries it. The count starts from `sync`, follows
 * `conversation.read`, and grows with each customer message.
 */
export class BackendTranslator {
  userId: string | null = null;
  private readonly unread = new Map<string, number>();

  /** Frontend client event -> frames for the backend, plus events to answer the UI with locally. */
  toBackend(type: string, payload: unknown): { send: Frame[]; reply: Frame[] } {
    switch (type) {
      case "callback.request":
        // The backend has no callback flow yet; say so instead of sending an event it would reject.
        return { send: [], reply: [{ type: "notice", payload: { text: "Callback requests are not available yet" } }] };
      default:
        // sync.request, message.send, conversation.read/unread/takeover share names and shapes with the backend.
        return { send: [{ type, payload }], reply: [] };
    }
  }

  /** One backend frame -> the frontend events it stands for (possibly none). */
  fromBackend(frame: BackendFrame): Frame[] {
    const payload = frame.payload;
    switch (frame.type) {
      case "sync":
        return [this.sync(payload)];

      case "message.new": {
        const message = toMessage(payload.message as BackendMessage);
        if (message.side === "customer") this.bump(message.conversationId);
        return [{ type: "message.new", payload: { message } }];
      }

      case "message.ack":
        return [{ type: "message.ack", payload: { message: toMessage(payload.message as BackendMessage) } }];

      case "message.updated":
        return [{ type: "message.updated", payload: { message: toMessage(payload.message as BackendMessage) } }];

      case "message.deleted":
        return [
          { type: "message.deleted", payload: { conversationId: payload.conversationId, messageId: payload.id } },
        ];

      case "note.created":
      case "note.updated":
        return [{ type: frame.type, payload: { note: toNote(payload.note as BackendNote) } }];

      case "note.deleted":
        return [{ type: "note.deleted", payload: { conversationId: payload.conversationId, noteId: payload.id } }];

      case "conversation.escalated": {
        const escalation = payload.escalation as Record<string, unknown>;
        return [
          {
            type: "conversation.escalated",
            payload: {
              conversationId: escalation.conversationId,
              escalationId: escalation.id,
              status: escalation.status,
              requestedBy: escalation.requestedBy,
              ...(typeof escalation.reason === "string" ? { reason: escalation.reason } : {}),
            },
          },
        ];
      }

      case "attachment.deleted":
        return [
          {
            type: "attachment.deleted",
            payload: {
              conversationId: payload.conversationId,
              messageId: payload.messageId ?? null,
              attachmentId: payload.id,
            },
          },
        ];

      case "message.reaction_updated":
        return [
          {
            type: "message.reaction_updated",
            payload: {
              conversationId: payload.conversationId,
              messageId: payload.messageId,
              reactions: asArray<BackendReaction>(payload.reactions).map(toReaction),
            },
          },
        ];

      case "message.status": {
        const status = toDeliveryStatus(payload.status as BackendMessage["status"]);
        return asArray<string>(payload.messageIds).map((messageId) => ({
          type: "message.status",
          payload: { conversationId: payload.conversationId, messageId, status },
        }));
      }

      case "message.failed":
        return [
          {
            type: "message.failed",
            payload: {
              conversationId: String(payload.conversationId ?? ""),
              clientId: String(payload.clientId ?? ""),
              ...(typeof payload.message === "string" ? { reason: payload.message } : {}),
            },
          },
        ];

      case "conversation.created":
      case "conversation.updated":
      case "conversation.assigned":
      case "conversation.transferred":
      case "conversation.priority_changed":
      case "conversation.tags_updated":
      case "conversation.status_changed": {
        const source = payload.conversation as BackendConversation;
        return [
          { type: "conversation.updated", payload: { conversation: toConversation(source, this.unreadOf(source.id)) } },
        ];
      }

      case "conversation.hidden":
        this.unread.delete(String(payload.conversationId));
        return [{ type: "conversation.removed", payload: { conversationId: payload.conversationId } }];

      case "conversation.read": {
        const conversationId = String(payload.conversationId);
        const unread = Number(payload.unreadCount) || 0;
        this.unread.set(conversationId, unread);
        return [{ type: "conversation.unread", payload: { conversationId, unread } }];
      }

      case "typing":
        return [
          {
            type: "typing",
            payload: { conversationId: payload.conversationId, side: payload.side, active: payload.active },
          },
        ];

      case "notification.new":
        return [
          {
            type: "notification",
            payload: { notification: toNotification(payload.notification as BackendNotification, this.userId ?? "") },
          },
        ];

      // Per-agent workspace events already use the frontend's shape.
      case "workspace.tab_opened":
      case "workspace.tab_closed":
      case "workspace.draft_updated":
      case "workspace.preferences_updated":
        return [{ type: frame.type, payload }];

      case "error":
        return [{ type: "notice", payload: { text: String(payload.message ?? "Something went wrong") } }];

      // Handled by the socket (connection.*) or with no UI yet (presence.updated, notification.read).
      default:
        return [];
    }
  }

  private sync(payload: Record<string, unknown>): Frame {
    const sources = asArray<BackendConversation>(payload.conversations);
    this.unread.clear();
    for (const source of sources) this.unread.set(source.id, source.unreadCount ?? 0);

    const messages: Record<string, ChatMessageDto[]> = {};
    for (const [conversationId, list] of Object.entries((payload.messages ?? {}) as Record<string, BackendMessage[]>)) {
      messages[conversationId] = list.map(toMessage);
    }
    const agents = new Map(
      sources.flatMap((source) =>
        source.assignedAgent ? [[source.assignedAgent.id, toAgent(source.assignedAgent)] as const] : [],
      ),
    );

    return {
      type: "sync",
      payload: {
        conversations: sources.map((source) => toConversation(source, this.unreadOf(source.id))),
        messages,
        agents: [...agents.values()],
        // The backend sends only what the client was missing, so the lists are merged, not replaced.
        partial: true,
        incomplete: asArray<string>(payload.incomplete),
      },
    };
  }

  private unreadOf(conversationId: string) {
    return this.unread.get(conversationId) ?? 0;
  }

  private bump(conversationId: string) {
    this.unread.set(conversationId, this.unreadOf(conversationId) + 1);
  }
}
