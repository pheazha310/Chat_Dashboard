-- Tags and message reactions are soft-deleted: the row stays, `deleted_at` hides it.
ALTER TABLE "tags" ADD COLUMN "deleted_at" TIMESTAMPTZ(6), ADD COLUMN "deleted_by" UUID;
ALTER TABLE "message_reactions" ADD COLUMN "deleted_at" TIMESTAMPTZ(6);

-- A soft-deleted tag must not block reusing its name: uniqueness now applies to live tags only.
DROP INDEX "tags_name_key";
DROP INDEX "tags_name_lower_key";
CREATE UNIQUE INDEX "tags_name_lower_key" ON "tags" (lower("name")) WHERE "deleted_at" IS NULL;
