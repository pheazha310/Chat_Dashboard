import { z } from "zod";
import { assignBody, transferBody, unassignBody } from "@modules/assignments/assignment.schema.js";
import { statusBody } from "@modules/conversations/conversation.schema.js";
import { candidateSignal, sdpSignal } from "@modules/calls/call.schema.js";
import { readBody, sendBody } from "@modules/messages/message.schema.js";
import { setPresenceBody } from "@modules/presence/presence.schema.js";
import { idSchema } from "@shared/utils/ids.js";

/**
 * Client → server events. Payloads reuse the REST request schemas, so a rule that changes for REST changes here too.
 * The WebSocket contract is documented in docs/websocket-events.md.
 */
const conversationId = idSchema;

export const clientEvents = {
  auth: z.object({ token: z.string().min(1).max(4096), reconnect: z.boolean().optional() }),
  "sync.request": z.object({
    selectedConversationId: idSchema.optional(),
    /** conversationId → last sequenceNumber the client holds; the reply carries everything after it. */
    cursors: z
      .record(z.uuid(), z.string().regex(/^\d{1,18}$/))
      .refine((value) => Object.keys(value).length <= 50, "At most 50 cursors")
      .optional(),
  }),
  "message.send": sendBody.extend({ conversationId }),
  "message.delivered": z.object({ conversationId, messageId: idSchema }),
  "conversation.read": readBody.extend({ conversationId }),
  "conversation.unread": z.object({ conversationId }),
  "conversation.takeover": z.object({ conversationId }),
  "conversation.assign": assignBody.extend({ conversationId }),
  "conversation.transfer": transferBody.extend({ conversationId }),
  "conversation.release": unassignBody.extend({ conversationId }),
  "conversation.set_status": statusBody.extend({ conversationId }),
  "typing.start": z.object({ conversationId }),
  "typing.stop": z.object({ conversationId }),
  /** Omit `notificationId` to mark all of the caller's notifications read. */
  "notification.read": z.object({ notificationId: idSchema.optional() }),
  "presence.set": setPresenceBody,
  /** WebRTC signalling for an answered call (docs/api-calls.md). Sent by the party who is a participant. */
  "call.offer": sdpSignal,
  "call.answer": sdpSignal,
  "call.ice_candidate": candidateSignal,
} as const;

export type ClientEventName = keyof typeof clientEvents;
export type ClientPayload<K extends ClientEventName> = z.infer<(typeof clientEvents)[K]>;

export const isClientEvent = (type: string): type is ClientEventName => Object.hasOwn(clientEvents, type);

/** Close codes (4000+ are application defined). */
export const CLOSE = { unauthorized: 4401, forbidden: 4403, tooLarge: 1009 } as const;

export const MAX_FRAME_BYTES = 64 * 1024;
export const AUTH_TIMEOUT_MS = 10_000;
export const TYPING_TTL_MS = 5_000;
export const SYNC_INBOX_SIZE = 100;
export const SYNC_MESSAGES_PER_CONVERSATION = 100;
export const SYNC_LATEST_FOR_SELECTED = 50;
