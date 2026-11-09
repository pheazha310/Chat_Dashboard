export type SpamStatus = "PENDING" | "CONFIRMED" | "DISMISSED";
export type ModerationTarget = "CUSTOMER" | "CONVERSATION" | "MESSAGE" | "KEYWORD" | "SPAM_REPORT";

export interface BlockDto {
  id: string;
  customerId: string;
  /** From Backend 1; null when it cannot be reached. */
  customerName: string | null;
  blockedBy: string;
  reason: string | null;
  blockedAt: string;
  unblockedAt: string | null;
  unblockedBy: string | null;
  permissions: { canUnblock: boolean };
}

export interface KeywordDto {
  id: string;
  keyword: string;
  isActive: boolean;
  createdBy: string | null;
  createdAt: string;
}

export interface SpamReportDto {
  id: string;
  conversationId: string;
  reportedBy: { type: "AGENT" | "CUSTOMER"; id: string };
  messageId: string | null;
  reason: string;
  status: SpamStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  resolutionNote: string | null;
  createdAt: string;
}

export interface ModerationActivityDto {
  id: string;
  actorId: string;
  action: string;
  targetType: ModerationTarget;
  targetId: string;
  metadata: unknown;
  createdAt: string;
}
