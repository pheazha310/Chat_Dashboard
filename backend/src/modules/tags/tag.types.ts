export interface TagDto {
  id: string;
  name: string;
  /** `#RRGGBB`, or null. */
  color: string | null;
  /** Backend 1 id of the agent who created it. */
  createdBy: string | null;
  /** In how many conversations the tag is used. */
  usageCount: number;
  createdAt: string;
}

export interface ConversationTagsDto {
  conversationId: string;
  tags: { id: string; name: string; color: string | null }[];
}
