import type { AuthContext, Role } from "./auth.types.js";

/**
 * Every permission the services check, as `module.action`, with what it allows. The same list is seeded into the
 * `permissions` table by migrations (a test keeps them identical); which role has which is data (`role_permissions`),
 * edited by admins under /api/v1/admin/roles. Ownership rules stay in code: an agent can always act on their own
 * messages, notes, tags, callbacks and conversations; these permissions extend that to everyone else's.
 */
export const PERMISSIONS = {
  "conversations.view_all": "See and open every conversation, including ones assigned to other agents",
  "conversations.manage_all":
    "Take over, assign, transfer, unassign, resolve, close and archive any conversation, not only one's own",
  "customers.view_contact": "See a customer's contact details in any conversation, not only one's own",
  "customers.view_sensitive": "See a customer's sensitive loan data (national id, salary, occupation, blacklist)",
  "messages.delete_any": "Delete any agent's or customer's message",
  "messages.view_history_any": "See the edit history of any message, and deleted messages",
  "attachments.delete_any": "Delete any uploaded file",
  "notes.delete_any": "Delete any internal note",
  "tags.edit_any": "Rename or recolour any tag, not only one's own",
  "tags.delete": "Delete tags",
  "canned_responses.manage_shared": "Create, edit and delete shared reply templates, and see inactive ones",
  "callbacks.view_all": "List and open everyone's callbacks",
  "callbacks.manage_all": "Edit, complete and cancel any callback",
  "calls.answer_any": "Answer customer calls in conversations owned by another agent",
  "calls.end_any": "End any active call, even without having joined it",
  "escalations.resolve": "Resolve escalations",
  "escalations.manage_all": "Cancel escalations raised by others",
  "moderation.block_any": "Block customers directly or from any conversation, see every block and lift any block",
  "moderation.manage_keywords": "Manage blocked keywords",
  "moderation.review_reports": "See every spam report and review them",
  "moderation.view_log": "Read the moderation log",
  "automation.manage": "Edit the automatic replies and approve AI training examples",
  "users.read": "View staff and customer accounts",
  "users.manage": "Create staff accounts, change roles and status, reset passwords",
  "roles.read": "View roles and their permissions",
  "roles.manage": "Change which permissions each role has",
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const PERMISSION_NAMES = Object.keys(PERMISSIONS) as Permission[];

const SUPERVISOR_PERMISSIONS = PERMISSION_NAMES.filter((name) => name !== "users.manage" && name !== "roles.manage");

/**
 * The grants the migration seeds, which reproduce the rules from before permissions were data: supervisors and admins
 * may do everything above, only admins manage accounts and roles. Also used for identities whose permissions were not
 * loaded from the database (unit tests, contexts built by hand).
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  CUSTOMER: [],
  AGENT: [],
  SUPERVISOR: SUPERVISOR_PERMISSIONS,
  ADMIN: PERMISSION_NAMES,
};

/** Permissions an admin can never take away from ADMIN, so nobody can lock everyone out of account and role management. */
export const ADMIN_LOCKED_PERMISSIONS: readonly Permission[] = ["users.manage", "roles.manage"];

const defaults = new Map(
  Object.entries(DEFAULT_ROLE_PERMISSIONS).map(([role, list]) => [role, new Set<string>(list)] as const),
);

/** Whether the caller's role grants `permission` (loaded with the identity, else the defaults above). */
export function can(auth: AuthContext, permission: Permission): boolean {
  return (auth.permissions ?? defaults.get(auth.role))?.has(permission) ?? false;
}
