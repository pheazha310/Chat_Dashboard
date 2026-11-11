-- CreateTable
CREATE TABLE "message_pins" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "pinned_by" UUID NOT NULL,
    "pinned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unpinned_at" TIMESTAMPTZ(6),
    "unpinned_by" UUID,

    CONSTRAINT "message_pins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "message_pins_message_id_key" ON "message_pins"("message_id");

-- CreateIndex
CREATE INDEX "message_pins_conversation_id_pinned_at_idx" ON "message_pins"("conversation_id", "pinned_at");

-- AddForeignKey
ALTER TABLE "message_pins" ADD CONSTRAINT "message_pins_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_pins" ADD CONSTRAINT "message_pins_message_id_conversation_id_fkey" FOREIGN KEY ("message_id", "conversation_id") REFERENCES "messages"("id", "conversation_id") ON DELETE RESTRICT ON UPDATE CASCADE;
