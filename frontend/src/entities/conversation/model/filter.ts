import type { Conversation, ConversationFilter } from "./store";

export const FILTERS: { id: ConversationFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "mine", label: "Mine" },
  { id: "unread", label: "Unread" },
  { id: "unassigned", label: "Unassigned" },
  { id: "archived", label: "Archived" },
];

/**
 * The inbox the agent sees: a filter tab plus the search box. "Unassigned" means waiting in the shared queue.
 * Access control is the backend's job (it only sends conversations the agent may open); this only narrows the list.
 */
export function filterConversations(
  conversations: (Conversation | undefined)[],
  { filter, query, me }: { filter: ConversationFilter; query: string; me: string | null },
): Conversation[] {
  const needle = query.trim().toLowerCase();
  return conversations.filter((conversation): conversation is Conversation => {
    if (!conversation) return false;
    if (filter === "archived" ? !conversation.archived : conversation.archived) return false;
    if (filter === "mine" && (me === null || conversation.assignedAgent?.id !== me)) return false;
    if (filter === "unread" && conversation.unread === 0) return false;
    if (filter === "unassigned" && conversation.handoff !== "needs-human") return false;
    return conversation.name.toLowerCase().includes(needle) || conversation.preview.toLowerCase().includes(needle);
  });
}
