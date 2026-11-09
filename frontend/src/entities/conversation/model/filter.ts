import type { Conversation, ConversationFilter, ConversationSort, PriorityFilter } from "./store";

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
  {
    filter,
    query,
    me,
    priority = "all",
    tag = null,
    sort = "recent",
  }: {
    filter: ConversationFilter;
    query: string;
    me: string | null;
    priority?: PriorityFilter;
    tag?: string | null;
    sort?: ConversationSort;
  },
): Conversation[] {
  const needle = query.trim().toLowerCase();
  const matches = conversations.filter((conversation): conversation is Conversation => {
    if (!conversation) return false;
    if (filter === "archived" ? !conversation.archived : conversation.archived) return false;
    if (filter === "mine" && (me === null || conversation.assignedAgent?.id !== me)) return false;
    if (filter === "unread" && conversation.unread === 0) return false;
    if (filter === "unassigned" && conversation.handoff !== "needs-human") return false;
    if (priority !== "all" && conversation.priority !== priority) return false;
    if (tag !== null && !conversation.tags?.some((t) => t.id === tag)) return false;
    return conversation.name.toLowerCase().includes(needle) || conversation.preview.toLowerCase().includes(needle);
  });
  if (sort !== "priority") return matches;
  // Array.prototype.sort is stable, so the latest-first order is kept inside each priority.
  return [...matches].sort((a, b) => rank(a) - rank(b));
}

const RANK = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
const rank = (conversation: Conversation) => RANK[conversation.priority ?? (conversation.urgent ? "HIGH" : "MEDIUM")];
