-- CreateTable
CREATE TABLE "conversation_drafts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agent_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversation_drafts_conversation_id_idx" ON "conversation_drafts"("conversation_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_drafts_agent_id_conversation_id_key" ON "conversation_drafts"("agent_id", "conversation_id");

-- AddForeignKey
ALTER TABLE "conversation_drafts" ADD CONSTRAINT "conversation_drafts_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Constraints Prisma cannot express (also in prisma/sql/constraints.sql)
ALTER TABLE conversation_drafts ADD CONSTRAINT conversation_drafts_content_length CHECK (char_length(content) BETWEEN 1 AND 10000);
