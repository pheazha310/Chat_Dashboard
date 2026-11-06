import type { BackendConversation } from "@/shared/api/backend/types";
import { apiRequest } from "./client";

export type WorkspacePreferences = { restoreTabs: boolean; persistTabs: boolean };
export type WorkspaceTab = {
  conversationId: string;
  sortOrder: number;
  lastOpenedAt: string;
  conversation: BackendConversation;
};
export type WorkspaceDraft = { conversationId: string; content: string; updatedAt: string };
export type Workspace = { preferences: WorkspacePreferences; tabs: WorkspaceTab[]; drafts: WorkspaceDraft[] };

/** Per-agent workspace state (docs/api-workspace.md). Closing a tab never changes the conversation itself. */
export const getWorkspace = async () => (await apiRequest<Workspace>("/workspace")).data;

export const updateWorkspacePreferences = async (patch: Partial<WorkspacePreferences>) =>
  (await apiRequest<WorkspacePreferences>("/workspace/preferences", { method: "PATCH", body: patch })).data;

export const openTabRequest = (conversationId: string) =>
  apiRequest<{ persisted: boolean }>(`/workspace/tabs/${conversationId}`, { method: "PUT" });

export const closeTabRequest = (conversationId: string) =>
  apiRequest<unknown>(`/workspace/tabs/${conversationId}`, { method: "DELETE" });

/** An empty `content` deletes the draft. */
export const saveDraftRequest = (conversationId: string, content: string) =>
  apiRequest<WorkspaceDraft | null>(`/workspace/drafts/${conversationId}`, { method: "PUT", body: { content } });

export const clearDraftRequest = (conversationId: string) =>
  apiRequest<unknown>(`/workspace/drafts/${conversationId}`, { method: "DELETE" });
