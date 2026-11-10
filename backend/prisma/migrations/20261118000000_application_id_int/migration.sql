-- The loan application id is LOS's integer id, not a UUID. Existing UUID values cannot be converted, so they are
-- cleared. Indexes on the column (including conversations_one_open_per_application) are rebuilt by ALTER TYPE.
ALTER TABLE "conversations" ALTER COLUMN "application_id" TYPE INTEGER USING NULL;

-- Conversations opened from the mobile app had no customer_name; snapshot the account's display name.
UPDATE "conversations" AS c
SET "customer_name" = LEFT(u."display_name", 150)
FROM "users" AS u
WHERE c."customer_id" = u."id" AND c."customer_name" IS NULL;
