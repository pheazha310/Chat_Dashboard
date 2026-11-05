import { isSupervisor, type AuthContext } from "@shared/auth/auth.types.js";

/** What the caller may do right now. The server enforces the same rules; the UI only reads these flags. */
export interface ConversationPermissions {
  canSendMessage: boolean;
  canTakeOver: boolean;
  canAssignOthers: boolean;
  canTransfer: boolean;
  canUnassign: boolean;
  canResolve: boolean;
  canClose: boolean;
  canReopen: boolean;
  canArchive: boolean;
  canRestore: boolean;
}

/** The conversation fields the rules depend on. */
export interface PolicyInput {
  status: string;
  handoffStatus: string;
  assignedAgentId: bigint | null;
  isArchived: boolean;
}

export const isOwner = (auth: AuthContext, conversation: Pick<PolicyInput, "assignedAgentId">) =>
  conversation.assignedAgentId === auth.userId;

/**
 * Visibility (docs/chat-logic-design.md §3): supervisors see everything. An agent sees AI-handled and waiting
 * conversations, ones they own, and ones they were added to as VIEWER. Other agents' chats are hidden.
 */
export const canView = (auth: AuthContext, conversation: PolicyInput, isViewer: boolean) =>
  isSupervisor(auth) || conversation.handoffStatus !== "ASSIGNED" || isOwner(auth, conversation) || isViewer;

/** Permission matrix (§6), enforced here in the service layer and reported to the UI as flags. */
export function permissionsFor(auth: AuthContext, c: PolicyInput): ConversationPermissions {
  const supervisor = isSupervisor(auth);
  const owner = isOwner(auth, c);
  const manages = supervisor || owner;
  const open = c.status !== "CLOSED";
  const assigned = c.handoffStatus === "ASSIGNED";
  const canArchiveNow = manages || c.assignedAgentId === null;
  return {
    canSendMessage: owner && open && !c.isArchived,
    // Waiting conversations can be taken by any agent; AI-handled or someone else's only by a supervisor.
    canTakeOver: open && !owner && (c.handoffStatus === "NEEDS_HUMAN" || supervisor),
    canAssignOthers: open && supervisor,
    canTransfer: open && assigned && manages,
    canUnassign: open && assigned && manages,
    canResolve: c.status === "OPEN" && manages,
    canClose: open && manages,
    canReopen: c.status !== "OPEN",
    canArchive: !c.isArchived && canArchiveNow,
    canRestore: c.isArchived && canArchiveNow,
  };
}
