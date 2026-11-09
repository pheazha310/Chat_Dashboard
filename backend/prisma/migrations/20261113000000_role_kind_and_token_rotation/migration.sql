-- Two links from the ERD review of 2026-11-09:
-- 1. chat_users (role_id, user_type) references roles (id, kind), so a chat user's kind always matches its role
--    (a STAFF row can no longer point at the CUSTOMER role, or the other way round).
-- 2. auth_sessions.replaced_by_id records which session a refresh rotated into, making each sign-in a chain.

-- ─── chat_users → roles (id, kind) ───────────────────────────────────────────

CREATE UNIQUE INDEX "roles_id_kind_key" ON "roles"("id", "kind");

-- The application always wrote matching values; align any row that does not before the key is checked.
UPDATE chat_users cu SET user_type = r.kind FROM roles r WHERE r.id = cu.role_id AND cu.user_type <> r.kind;

ALTER TABLE "chat_users" DROP CONSTRAINT "chat_users_role_id_fkey";
ALTER TABLE "chat_users" ADD CONSTRAINT "chat_users_role_id_user_type_fkey" FOREIGN KEY ("role_id", "user_type") REFERENCES "roles"("id", "kind") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── auth_sessions rotation chain ────────────────────────────────────────────

ALTER TABLE "auth_sessions" ADD COLUMN "replaced_by_id" UUID;
CREATE UNIQUE INDEX "auth_sessions_replaced_by_id_key" ON "auth_sessions"("replaced_by_id");
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_replaced_by_id_fkey" FOREIGN KEY ("replaced_by_id") REFERENCES "auth_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- A session is never its own successor, and only a revoked session has one.
ALTER TABLE auth_sessions ADD CONSTRAINT auth_sessions_replaced_by_not_self CHECK (replaced_by_id <> id);
ALTER TABLE auth_sessions ADD CONSTRAINT auth_sessions_replaced_needs_revoked CHECK (replaced_by_id IS NULL OR revoked_at IS NOT NULL);
