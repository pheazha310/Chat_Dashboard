import { create } from "zustand";
import { useConversationStore } from "@/entities/conversation";
import { useMessageStore } from "@/entities/message";
import { searchAllMessages } from "@/shared/api/rest";
import { isMockTransport } from "@/shared/api/ws";
import { notify } from "@/shared/ui";

/** A message found by the inbox search, shown under its customer. */
export type InboxHit = {
  messageId: string;
  conversationId: string;
  /** Missing only for mock messages, which are always held. */
  sequence?: string;
  customer: string;
  text: string;
  createdAt: string;
};

type InboxSearchState = { results: InboxHit[]; hasMore: boolean; searching: boolean };

export const useInboxSearchStore = create<InboxSearchState>(() => ({ results: [], hasMore: false, searching: false }));

let latestRequest = 0;

/** Searches message text in every conversation the agent may open, newest first. */
export async function searchEverywhere(query: string): Promise<void> {
  const request = ++latestRequest;
  const text = query.trim();
  if (!text) {
    useInboxSearchStore.setState({ results: [], hasMore: false, searching: false });
    return;
  }
  useInboxSearchStore.setState({ searching: true });
  try {
    const found = isMockTransport ? { results: searchHeld(text), hasMore: false } : await searchServer(text);
    if (request === latestRequest) useInboxSearchStore.setState({ ...found, searching: false });
  } catch {
    if (request !== latestRequest) return;
    useInboxSearchStore.setState({ results: [], hasMore: false, searching: false });
    notify("Message search failed, please try again");
  }
}

async function searchServer(text: string) {
  const { items, hasMore } = await searchAllMessages(text);
  const results = items.map(({ message, conversation }) => ({
    messageId: message.id,
    conversationId: conversation.id,
    sequence: message.sequenceNumber,
    customer: conversation.customerName ?? conversation.customerIdentifier ?? "Customer",
    text: message.content ?? "",
    createdAt: message.createdAt,
  }));
  return { results, hasMore };
}

/** The mock server holds every thread in memory: match word starts like the server's full-text search. */
function searchHeld(text: string): InboxHit[] {
  const wanted = words(text);
  const names = useConversationStore.getState().byId;
  return Object.values(useMessageStore.getState().byConversation)
    .flat()
    .filter((m) => m.side !== "system" && !m.deleted)
    .filter((m) => {
      const have = words(m.text);
      return wanted.every((word) => have.some((h) => h.startsWith(word)));
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((m) => ({
      messageId: m.id,
      conversationId: m.conversationId,
      ...(m.sequence === undefined ? {} : { sequence: m.sequence }),
      customer: names[m.conversationId]?.name ?? "Customer",
      text: m.text,
      createdAt: m.createdAt,
    }));
}

const words = (value: string) => value.toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
