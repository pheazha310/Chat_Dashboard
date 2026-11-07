-- CreateTable
CREATE TABLE "chat_users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_type" VARCHAR(20) NOT NULL,
    "external_id" UUID NOT NULL,
    "role" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chat_users_user_type_external_id_key" ON "chat_users"("user_type", "external_id");

-- Constraints Prisma cannot express (also in prisma/sql/constraints.sql)
ALTER TABLE chat_users ADD CONSTRAINT chat_users_user_type_check CHECK (user_type IN ('CUSTOMER', 'STAFF'));
ALTER TABLE chat_users ADD CONSTRAINT chat_users_role_check CHECK (role IN ('CUSTOMER', 'AGENT', 'SUPERVISOR', 'ADMIN'));
ALTER TABLE chat_users ADD CONSTRAINT chat_users_status_check CHECK (status IN ('ACTIVE', 'DISABLED'));
