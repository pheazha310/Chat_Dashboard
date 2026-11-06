import type { ConversationSummaryDto } from "@modules/conversations/index.js";

/** Stored in workspace_preferences.settings. Both default to on. */
export interface WorkspacePreferencesDto {
  /** Reopen the tabs of the last session when the dashboard loads. */
  restoreTabs: boolean;
  /** Save opened and closed tabs. When off, tab calls succeed but store nothing. */
  persistTabs: boolean;
}

export interface WorkspaceTabDto {
  conversationId: string;
  sortOrder: number;
  lastOpenedAt: string;
  /** Current state of the conversation including this agent's unread count. */
  conversation: ConversationSummaryDto;
}

export interface DraftDto {
  conversationId: string;
  content: string;
  updatedAt: string;
}

export interface WorkspaceDto {
  preferences: WorkspacePreferencesDto;
  /** Empty when `restoreTabs` is off. Conversations the agent can no longer see are left out. */
  tabs: WorkspaceTabDto[];
  /** Drafts of conversations the agent can still see. */
  drafts: DraftDto[];
}

export interface OpenTabResult {
  conversationId: string;
  /** False when `persistTabs` is off and nothing was stored. */
  persisted: boolean;
  sortOrder: number | null;
}

/** Realtime payloads sent to every session of the same agent. */
export type WorkspaceEvent =
  | { type: "workspace.tab_opened"; payload: { conversationId: string; sortOrder: number; lastOpenedAt: string } }
  | { type: "workspace.tab_closed"; payload: { conversationId: string } }
  | { type: "workspace.draft_updated"; payload: { conversationId: string; content: string | null; updatedAt: string } }
  | { type: "workspace.preferences_updated"; payload: { preferences: WorkspacePreferencesDto } };
