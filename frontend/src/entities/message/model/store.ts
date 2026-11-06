import { create } from "zustand";
import type { ChatMessageDto, DeliveryStatus, MessageSide, ReactionDto } from "@/shared/api/ws";

export type ChatMessage = ChatMessageDto;

/** Where a conversation's server-side history stands. Only used with the real backend. */
export type HistoryState = {
  loading: boolean;
  loaded: boolean;
  hasMore: boolean;
  /** Sequence number of the oldest message held, the cursor for "load earlier". */
  oldest?: string;
};

type MessageState = {
  byConversation: Record<string, ChatMessage[]>;
  typing: Record<string, MessageSide | undefined>;
  history: Record<string, HistoryState>;
  /** The message the agent is replying to, per conversation (composer state shared by the bubble and the composer). */
  replyTarget: Record<string, string | undefined>;
  replaceAll: (messages: Record<string, ChatMessage[]>) => void;
  mergeMany: (messages: Record<string, ChatMessage[]>) => void;
  upsert: (message: ChatMessage) => void;
  setStatus: (conversationId: string, messageId: string, status: DeliveryStatus) => void;
  setTyping: (conversationId: string, side: MessageSide, active: boolean) => void;
  setHistory: (conversationId: string, patch: Partial<HistoryState>) => void;
  /** A message was deleted (it is gone from history too). */
  remove: (conversationId: string, messageId: string) => void;
  setReactions: (conversationId: string, messageId: string, reactions: ReactionDto[]) => void;
  /** A file was deleted from a message. */
  removeAttachment: (conversationId: string, attachmentId: string) => void;
  setReplyTarget: (conversationId: string, messageId: string | undefined) => void;
};

const EMPTY: ChatMessage[] = [];
const NO_HISTORY: HistoryState = { loading: false, loaded: false, hasMore: false };

const seq = (message: ChatMessage) => (message.sequence === undefined ? null : BigInt(message.sequence));

/** Does `incoming` replace `existing`? Same id, or the server copy of a message this client sent optimistically. */
const sameMessage = (existing: ChatMessage, incoming: ChatMessage) =>
  existing.id === incoming.id ||
  (incoming.clientId !== undefined && (existing.id === incoming.clientId || existing.clientId === incoming.clientId));

/** Adds or replaces one message. New ones go in sequence order; unsequenced (pending) ones stay at the end. */
function put(list: ChatMessage[], message: ChatMessage): ChatMessage[] {
  const index = list.findIndex((item) => sameMessage(item, message));
  if (index !== -1) return list.map((item, i) => (i === index ? message : item));
  const incoming = seq(message);
  if (incoming === null) return [...list, message];
  // Messages without a sequence are still pending (optimistic); they stay below everything the server has numbered.
  const before = list.findIndex((item) => {
    const other = seq(item);
    return other === null || other > incoming;
  });
  return before === -1 ? [...list, message] : [...list.slice(0, before), message, ...list.slice(before)];
}

export const useMessageStore = create<MessageState>((set) => ({
  byConversation: {},
  typing: {},
  history: {},
  replyTarget: {},
  // Keep optimistic messages the server has not acknowledged yet.
  replaceAll: (incoming) =>
    set((state) => {
      const merged = { ...incoming };
      for (const [conversationId, local] of Object.entries(state.byConversation)) {
        const known = new Set((incoming[conversationId] ?? []).map((message) => message.id));
        const pending = local.filter((message) => message.status === "sending" && !known.has(message.id));
        if (pending.length) merged[conversationId] = [...(merged[conversationId] ?? []), ...pending];
      }
      return { byConversation: merged };
    }),
  // For partial syncs and history pages: add what is missing, keep everything already held.
  mergeMany: (incoming) =>
    set((state) => {
      const next = { ...state.byConversation };
      for (const [conversationId, messages] of Object.entries(incoming)) {
        next[conversationId] = messages.reduce(put, next[conversationId] ?? EMPTY);
      }
      return { byConversation: next };
    }),
  upsert: (message) =>
    set((state) => ({
      byConversation: {
        ...state.byConversation,
        [message.conversationId]: put(state.byConversation[message.conversationId] ?? EMPTY, message),
      },
    })),
  setStatus: (conversationId, messageId, status) =>
    set((state) => ({
      byConversation: {
        ...state.byConversation,
        [conversationId]: (state.byConversation[conversationId] ?? EMPTY).map((message) =>
          message.id === messageId ? { ...message, status } : message,
        ),
      },
    })),
  remove: (conversationId, messageId) =>
    set((state) => ({
      byConversation: {
        ...state.byConversation,
        [conversationId]: (state.byConversation[conversationId] ?? EMPTY).filter((m) => m.id !== messageId),
      },
      replyTarget:
        state.replyTarget[conversationId] === messageId
          ? { ...state.replyTarget, [conversationId]: undefined }
          : state.replyTarget,
    })),
  setReactions: (conversationId, messageId, reactions) =>
    set((state) => ({
      byConversation: {
        ...state.byConversation,
        [conversationId]: (state.byConversation[conversationId] ?? EMPTY).map((m) =>
          m.id === messageId ? { ...m, reactions } : m,
        ),
      },
    })),
  removeAttachment: (conversationId, attachmentId) =>
    set((state) => ({
      byConversation: {
        ...state.byConversation,
        [conversationId]: (state.byConversation[conversationId] ?? EMPTY).map((m) =>
          m.attachments?.some((a) => a.id === attachmentId)
            ? { ...m, attachments: m.attachments.filter((a) => a.id !== attachmentId) }
            : m,
        ),
      },
    })),
  setReplyTarget: (conversationId, messageId) =>
    set((state) => ({ replyTarget: { ...state.replyTarget, [conversationId]: messageId } })),
  setTyping: (conversationId, side, active) =>
    set((state) => ({
      typing: { ...state.typing, [conversationId]: active ? side : undefined },
    })),
  setHistory: (conversationId, patch) =>
    set((state) => ({
      history: {
        ...state.history,
        [conversationId]: { ...NO_HISTORY, ...state.history[conversationId], ...patch },
      },
    })),
}));

export const useConversationMessages = (conversationId: string | null) =>
  useMessageStore((state) => (conversationId ? (state.byConversation[conversationId] ?? EMPTY) : EMPTY));

export const useHistory = (conversationId: string | null) =>
  useMessageStore((state) => (conversationId ? state.history[conversationId] : undefined));

/** The newest sequence number held per conversation: the cursor a reconnect sync resumes from. */
export function newestSequences(byConversation: Record<string, ChatMessage[]>): Record<string, string> {
  const cursors: Record<string, string> = {};
  for (const [conversationId, messages] of Object.entries(byConversation)) {
    let newest: bigint | null = null;
    for (const message of messages) {
      const value = seq(message);
      if (value !== null && (newest === null || value > newest)) newest = value;
    }
    if (newest !== null) cursors[conversationId] = newest.toString();
  }
  return cursors;
}
