import { create } from "zustand";
import type { ChatMessageDto, DeliveryStatus, MessageSide } from "@/shared/api/ws";

export type ChatMessage = ChatMessageDto;

type MessageState = {
  byConversation: Record<string, ChatMessage[]>;
  typing: Record<string, MessageSide | undefined>;
  replaceAll: (messages: Record<string, ChatMessage[]>) => void;
  upsert: (message: ChatMessage) => void;
  setStatus: (conversationId: string, messageId: string, status: DeliveryStatus) => void;
  setTyping: (conversationId: string, side: MessageSide, active: boolean) => void;
};

const EMPTY: ChatMessage[] = [];

export const useMessageStore = create<MessageState>((set) => ({
  byConversation: {},
  typing: {},
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
  upsert: (message) =>
    set((state) => {
      const list = state.byConversation[message.conversationId] ?? EMPTY;
      const index = list.findIndex((item) => item.id === message.id);
      const next = index === -1 ? [...list, message] : list.map((item, i) => (i === index ? message : item));
      return {
        byConversation: {
          ...state.byConversation,
          [message.conversationId]: next,
        },
      };
    }),
  setStatus: (conversationId, messageId, status) =>
    set((state) => ({
      byConversation: {
        ...state.byConversation,
        [conversationId]: (state.byConversation[conversationId] ?? EMPTY).map((message) =>
          message.id === messageId ? { ...message, status } : message,
        ),
      },
    })),
  setTyping: (conversationId, side, active) =>
    set((state) => ({
      typing: { ...state.typing, [conversationId]: active ? side : undefined },
    })),
}));

export const useConversationMessages = (conversationId: string | null) =>
  useMessageStore((state) => (conversationId ? (state.byConversation[conversationId] ?? EMPTY) : EMPTY));
