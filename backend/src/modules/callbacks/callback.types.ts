export type CallbackStatus = "PENDING" | "COMPLETED" | "CANCELLED" | "MISSED";

export interface CallbackDto {
  id: string;
  conversationId: string;
  customerId: string;
  /** The agent who should make the call. Reminders go to this agent. */
  assignedAgentId: string | null;
  createdBy: string | null;
  scheduledAt: string;
  status: CallbackStatus;
  notes: string | null;
  completionNote: string | null;
  createdAt: string;
  completedAt: string | null;
  /** What the caller may do now. Only open callbacks (PENDING or MISSED) can be changed. */
  permissions: { canEdit: boolean; canComplete: boolean; canCancel: boolean };
}

export interface CallbackOptions {
  /** How long before the scheduled time the assignee gets a reminder. */
  reminderLeadMs: number;
  /** How long after the scheduled time a still-pending callback is marked MISSED. */
  missedAfterMs: number;
}

export const DEFAULT_CALLBACK_OPTIONS: CallbackOptions = {
  reminderLeadMs: 10 * 60_000,
  missedAfterMs: 15 * 60_000,
};
