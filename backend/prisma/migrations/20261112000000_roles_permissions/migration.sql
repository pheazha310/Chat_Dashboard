-- Roles and permissions as data (roles, permissions, role_permissions), chat_users linked to roles, and foreign keys
-- from conversations, messages and attachments to chat_users. The permission catalogue mirrors
-- src/shared/auth/permissions.ts; the grants reproduce the rules from before (supervisors and admins could do
-- everything listed, only admins manage accounts and roles), so behaviour does not change until an admin edits them.

-- ─── roles / permissions ─────────────────────────────────────────────────────

CREATE TABLE "roles" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(20) NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "description" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "permissions" (
    "id" SERIAL NOT NULL,
    "module" VARCHAR(50) NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "description" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "role_permissions" (
    "id" SERIAL NOT NULL,
    "role_id" INTEGER NOT NULL,
    "permission_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");
CREATE UNIQUE INDEX "permissions_module_action_key" ON "permissions"("module", "action");
CREATE UNIQUE INDEX "role_permissions_role_id_permission_id_key" ON "role_permissions"("role_id", "permission_id");
CREATE INDEX "role_permissions_permission_id_idx" ON "role_permissions"("permission_id");

ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO roles (name, kind, description) VALUES
  ('CUSTOMER', 'CUSTOMER', 'Mobile app customer'),
  ('AGENT', 'STAFF', 'Support agent'),
  ('SUPERVISOR', 'STAFF', 'Supervises agents and conversations'),
  ('ADMIN', 'STAFF', 'Manages accounts and roles');

INSERT INTO permissions (module, action, description) VALUES
  ('conversations', 'view_all', 'See and open every conversation, including ones assigned to other agents'),
  ('conversations', 'manage_all', 'Take over, assign, transfer, unassign, resolve, close and archive any conversation, not only one''s own'),
  ('customers', 'view_contact', 'See a customer''s contact details in any conversation, not only one''s own'),
  ('customers', 'view_sensitive', 'See a customer''s sensitive loan data (national id, salary, occupation, blacklist)'),
  ('messages', 'delete_any', 'Delete any agent''s or customer''s message'),
  ('messages', 'view_history_any', 'See the edit history of any message, and deleted messages'),
  ('attachments', 'delete_any', 'Delete any uploaded file'),
  ('notes', 'delete_any', 'Delete any internal note'),
  ('tags', 'edit_any', 'Rename or recolour any tag, not only one''s own'),
  ('tags', 'delete', 'Delete tags'),
  ('canned_responses', 'manage_shared', 'Create, edit and delete shared reply templates, and see inactive ones'),
  ('callbacks', 'view_all', 'List and open everyone''s callbacks'),
  ('callbacks', 'manage_all', 'Edit, complete and cancel any callback'),
  ('calls', 'answer_any', 'Answer customer calls in conversations owned by another agent'),
  ('calls', 'end_any', 'End any active call, even without having joined it'),
  ('escalations', 'resolve', 'Resolve escalations'),
  ('escalations', 'manage_all', 'Cancel escalations raised by others'),
  ('moderation', 'block_any', 'Block customers directly or from any conversation, see every block and lift any block'),
  ('moderation', 'manage_keywords', 'Manage blocked keywords'),
  ('moderation', 'review_reports', 'See every spam report and review them'),
  ('moderation', 'view_log', 'Read the moderation log'),
  ('users', 'read', 'View staff and customer accounts'),
  ('users', 'manage', 'Create staff accounts, change roles and status, reset passwords'),
  ('roles', 'read', 'View roles and their permissions'),
  ('roles', 'manage', 'Change which permissions each role has');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM (VALUES
  ('SUPERVISOR', 'conversations', 'view_all'),
  ('SUPERVISOR', 'conversations', 'manage_all'),
  ('SUPERVISOR', 'customers', 'view_contact'),
  ('SUPERVISOR', 'customers', 'view_sensitive'),
  ('SUPERVISOR', 'messages', 'delete_any'),
  ('SUPERVISOR', 'messages', 'view_history_any'),
  ('SUPERVISOR', 'attachments', 'delete_any'),
  ('SUPERVISOR', 'notes', 'delete_any'),
  ('SUPERVISOR', 'tags', 'edit_any'),
  ('SUPERVISOR', 'tags', 'delete'),
  ('SUPERVISOR', 'canned_responses', 'manage_shared'),
  ('SUPERVISOR', 'callbacks', 'view_all'),
  ('SUPERVISOR', 'callbacks', 'manage_all'),
  ('SUPERVISOR', 'calls', 'answer_any'),
  ('SUPERVISOR', 'calls', 'end_any'),
  ('SUPERVISOR', 'escalations', 'resolve'),
  ('SUPERVISOR', 'escalations', 'manage_all'),
  ('SUPERVISOR', 'moderation', 'block_any'),
  ('SUPERVISOR', 'moderation', 'manage_keywords'),
  ('SUPERVISOR', 'moderation', 'review_reports'),
  ('SUPERVISOR', 'moderation', 'view_log'),
  ('SUPERVISOR', 'users', 'read'),
  ('SUPERVISOR', 'roles', 'read'),
  ('ADMIN', 'conversations', 'view_all'),
  ('ADMIN', 'conversations', 'manage_all'),
  ('ADMIN', 'customers', 'view_contact'),
  ('ADMIN', 'customers', 'view_sensitive'),
  ('ADMIN', 'messages', 'delete_any'),
  ('ADMIN', 'messages', 'view_history_any'),
  ('ADMIN', 'attachments', 'delete_any'),
  ('ADMIN', 'notes', 'delete_any'),
  ('ADMIN', 'tags', 'edit_any'),
  ('ADMIN', 'tags', 'delete'),
  ('ADMIN', 'canned_responses', 'manage_shared'),
  ('ADMIN', 'callbacks', 'view_all'),
  ('ADMIN', 'callbacks', 'manage_all'),
  ('ADMIN', 'calls', 'answer_any'),
  ('ADMIN', 'calls', 'end_any'),
  ('ADMIN', 'escalations', 'resolve'),
  ('ADMIN', 'escalations', 'manage_all'),
  ('ADMIN', 'moderation', 'block_any'),
  ('ADMIN', 'moderation', 'manage_keywords'),
  ('ADMIN', 'moderation', 'review_reports'),
  ('ADMIN', 'moderation', 'view_log'),
  ('ADMIN', 'users', 'read'),
  ('ADMIN', 'users', 'manage'),
  ('ADMIN', 'roles', 'read'),
  ('ADMIN', 'roles', 'manage')
) AS g(role, module, action)
JOIN roles r ON r.name = g.role
JOIN permissions p ON p.module = g.module AND p.action = g.action;

-- users.role must name a role.
ALTER TABLE "users" ADD CONSTRAINT "users_role_fkey" FOREIGN KEY ("role") REFERENCES "roles"("name") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── chat_users: role_id, username, los_user_id ──────────────────────────────

ALTER TABLE "chat_users"
  ADD COLUMN "role_id" INTEGER,
  ADD COLUMN "username" VARCHAR(100),
  ADD COLUMN "los_user_id" INTEGER,
  ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE chat_users c SET role_id = r.id FROM roles r WHERE r.name = c.role;
-- Replaced by role_id (its CHECK constraint goes with it).
ALTER TABLE "chat_users" DROP COLUMN "role";

-- Every account gets an identity, so its rows can reference it before its first sign-in.
INSERT INTO chat_users (user_type, external_id, role_id, status, username)
SELECT CASE WHEN u.role = 'CUSTOMER' THEN 'CUSTOMER' ELSE 'STAFF' END, u.id, r.id, u.status, u.display_name
FROM users u JOIN roles r ON r.name = u.role
WHERE NOT EXISTS (SELECT 1 FROM chat_users c WHERE c.external_id = u.id);

UPDATE chat_users c SET username = u.display_name FROM users u WHERE u.id = c.external_id AND c.username IS NULL;

-- Ids already stored in conversations, messages and attachments that have no identity yet (data from before identities
-- existed, or from development tokens) get one, so the foreign keys below hold.
INSERT INTO chat_users (user_type, external_id, role_id)
SELECT DISTINCT ON (x.id) x.kind, x.id, r.id
FROM (
  SELECT customer_id AS id, 'CUSTOMER' AS kind, 'CUSTOMER' AS role FROM conversations WHERE customer_id IS NOT NULL
  UNION ALL
  SELECT sender_id, CASE WHEN sender_type = 'CUSTOMER' THEN 'CUSTOMER' ELSE 'STAFF' END,
         CASE WHEN sender_type = 'CUSTOMER' THEN 'CUSTOMER' ELSE 'AGENT' END
  FROM messages WHERE sender_id IS NOT NULL
  UNION ALL
  SELECT uploaded_by_id, CASE WHEN uploaded_by_type = 'CUSTOMER' THEN 'CUSTOMER' ELSE 'STAFF' END,
         CASE WHEN uploaded_by_type = 'CUSTOMER' THEN 'CUSTOMER' ELSE 'AGENT' END
  FROM attachments
) x
JOIN roles r ON r.name = x.role
WHERE NOT EXISTS (SELECT 1 FROM chat_users c WHERE c.external_id = x.id)
ORDER BY x.id, x.kind;

ALTER TABLE "chat_users" ALTER COLUMN "role_id" SET NOT NULL;

-- Fails if one external id has two identities (a dev token used as both customer and staff): merge them first.
CREATE UNIQUE INDEX "chat_users_external_id_key" ON "chat_users"("external_id");
CREATE UNIQUE INDEX "chat_users_user_type_los_user_id_key" ON "chat_users"("user_type", "los_user_id");
CREATE INDEX "chat_users_role_id_idx" ON "chat_users"("role_id");

ALTER TABLE "chat_users" ADD CONSTRAINT "chat_users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── foreign keys to chat_users (by external_id = users.id; the stored ids do not change) ────────────────

ALTER TABLE "conversations" ADD CONSTRAINT "conversations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "chat_users"("external_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "chat_users"("external_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "chat_users"("external_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Constraints Prisma cannot express (also in prisma/sql/constraints.sql)
ALTER TABLE roles ADD CONSTRAINT roles_kind_check CHECK (kind IN ('CUSTOMER', 'STAFF'));
ALTER TABLE roles ADD CONSTRAINT roles_name_check CHECK (name IN ('CUSTOMER', 'AGENT', 'SUPERVISOR', 'ADMIN'));
ALTER TABLE permissions ADD CONSTRAINT permissions_module_check CHECK (module ~ '^[a-z_]+$');
ALTER TABLE permissions ADD CONSTRAINT permissions_action_check CHECK (action ~ '^[a-z_]+$');
