-- Rename auth_sessions to refresh_tokens (the name the LOS chat backend uses). A rename, not a copy: existing
-- refresh tokens keep working. Indexes and constraints get the names Prisma expects for the new table.

ALTER TABLE "auth_sessions" RENAME TO "refresh_tokens";

ALTER TABLE "refresh_tokens" RENAME CONSTRAINT "auth_sessions_pkey" TO "refresh_tokens_pkey";
ALTER TABLE "refresh_tokens" RENAME CONSTRAINT "auth_sessions_user_id_fkey" TO "refresh_tokens_user_id_fkey";
ALTER TABLE "refresh_tokens" RENAME CONSTRAINT "auth_sessions_replaced_by_id_fkey" TO "refresh_tokens_replaced_by_id_fkey";
ALTER TABLE "refresh_tokens" RENAME CONSTRAINT "auth_sessions_replaced_by_not_self" TO "refresh_tokens_replaced_by_not_self";
ALTER TABLE "refresh_tokens" RENAME CONSTRAINT "auth_sessions_replaced_needs_revoked" TO "refresh_tokens_replaced_needs_revoked";

ALTER INDEX "auth_sessions_token_hash_key" RENAME TO "refresh_tokens_token_hash_key";
ALTER INDEX "auth_sessions_replaced_by_id_key" RENAME TO "refresh_tokens_replaced_by_id_key";
ALTER INDEX "auth_sessions_user_id_idx" RENAME TO "refresh_tokens_user_id_idx";
ALTER INDEX "auth_sessions_family_id_idx" RENAME TO "refresh_tokens_family_id_idx";
ALTER INDEX "auth_sessions_expires_at_idx" RENAME TO "refresh_tokens_expires_at_idx";
