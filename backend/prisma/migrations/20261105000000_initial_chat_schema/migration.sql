-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID,
    "application_id" UUID,
    "customer_name" VARCHAR(150),
    "customer_identifier" VARCHAR(100),
    "conversation_type" VARCHAR(30) NOT NULL DEFAULT 'CUSTOMER_SUPPORT',
    "channel" VARCHAR(32) NOT NULL DEFAULT 'web',
    "created_by_type" VARCHAR(30),
    "created_by_id" UUID,
    "status" VARCHAR(30) NOT NULL DEFAULT 'OPEN',
    "priority" VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
    "conversation_mode" VARCHAR(20) NOT NULL DEFAULT 'AI',
    "handoff_status" VARCHAR(30) NOT NULL DEFAULT 'NONE',
    "assigned_agent_id" UUID,
    "subject" VARCHAR(255),
    "summary" TEXT,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMPTZ(6),
    "resolved_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "last_message_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_message_preview" VARCHAR(255),
    "last_sequence_number" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_participants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "participant_type" VARCHAR(30) NOT NULL,
    "participant_id" UUID,
    "participant_role" VARCHAR(30) NOT NULL DEFAULT 'MEMBER',
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMPTZ(6),

    CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "assigned_by" UUID,
    "assignment_type" VARCHAR(30) NOT NULL DEFAULT 'OWNER',
    "assignment_action" VARCHAR(30) NOT NULL DEFAULT 'ASSIGNED',
    "note" VARCHAR(500),
    "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(6),
    "ended_by" UUID,

    CONSTRAINT "conversation_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_activities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "actor_type" VARCHAR(30) NOT NULL,
    "actor_id" UUID,
    "activity_type" VARCHAR(50) NOT NULL,
    "description" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "client_id" VARCHAR(100),
    "sequence_number" BIGINT NOT NULL,
    "sender_type" VARCHAR(30) NOT NULL,
    "sender_id" UUID,
    "message_type" VARCHAR(30) NOT NULL DEFAULT 'TEXT',
    "content" TEXT,
    "metadata" JSONB,
    "reply_to_message_id" UUID,
    "forwarded_from_message_id" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'SENT',
    "is_edited" BOOLEAN NOT NULL DEFAULT false,
    "edited_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_receipts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "message_id" UUID NOT NULL,
    "recipient_type" VARCHAR(30) NOT NULL,
    "recipient_id" UUID NOT NULL,
    "delivered_at" TIMESTAMPTZ(6),
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_reads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "reader_type" VARCHAR(30) NOT NULL,
    "reader_id" UUID NOT NULL,
    "last_read_message_id" UUID,
    "last_read_sequence_number" BIGINT NOT NULL DEFAULT 0,
    "last_read_at" TIMESTAMPTZ(6),
    "marked_unread" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_reads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_edit_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "message_id" UUID NOT NULL,
    "editor_type" VARCHAR(30) NOT NULL,
    "editor_id" UUID NOT NULL,
    "previous_content" TEXT NOT NULL,
    "edited_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_edit_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_reactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "message_id" UUID NOT NULL,
    "user_type" VARCHAR(30) NOT NULL,
    "user_id" UUID NOT NULL,
    "emoji" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "uploaded_by_type" VARCHAR(30) NOT NULL,
    "uploaded_by_id" UUID NOT NULL,
    "storage_key" VARCHAR(500) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(150) NOT NULL,
    "file_size" BIGINT NOT NULL,
    "duration_ms" INTEGER,
    "waveform" JSONB,
    "checksum_sha256" VARCHAR(64),
    "upload_status" VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_attachments" (
    "message_id" UUID NOT NULL,
    "attachment_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_attachments_pkey" PRIMARY KEY ("message_id","attachment_id")
);

-- CreateTable
CREATE TABLE "internal_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "author_agent_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "internal_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "note_mentions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "note_id" UUID NOT NULL,
    "mentioned_agent_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "note_mentions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_escalations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "reason" TEXT,
    "status" VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    "resolved_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),

    CONSTRAINT "conversation_escalations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(100) NOT NULL,
    "color" VARCHAR(30),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_tags" (
    "conversation_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_tags_pkey" PRIMARY KEY ("conversation_id","tag_id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "recipient_type" VARCHAR(30) NOT NULL,
    "recipient_id" UUID NOT NULL,
    "conversation_id" UUID,
    "message_id" UUID,
    "notification_type" VARCHAR(50) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "body" TEXT,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agent_id" UUID NOT NULL,
    "new_message_enabled" BOOLEAN NOT NULL DEFAULT true,
    "assignment_enabled" BOOLEAN NOT NULL DEFAULT true,
    "transfer_enabled" BOOLEAN NOT NULL DEFAULT true,
    "mention_enabled" BOOLEAN NOT NULL DEFAULT true,
    "sound_enabled" BOOLEAN NOT NULL DEFAULT true,
    "browser_enabled" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_notification_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "is_muted" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_notification_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_presence_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agent_id" UUID NOT NULL,
    "status" VARCHAR(30) NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(6),

    CONSTRAINT "agent_presence_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canned_responses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" VARCHAR(255) NOT NULL,
    "content" TEXT NOT NULL,
    "shortcut" VARCHAR(50),
    "scope" VARCHAR(30) NOT NULL DEFAULT 'PERSONAL',
    "team_id" UUID,
    "created_by" UUID NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "canned_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(255) NOT NULL,
    "trigger_type" VARCHAR(50) NOT NULL,
    "conditions" JSONB,
    "response_content" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "rule_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "message_id" UUID,
    "execution_status" VARCHAR(30) NOT NULL,
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_handoffs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "requested_by_type" VARCHAR(30) NOT NULL,
    "requested_by_id" UUID,
    "reason" TEXT,
    "status" VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    "accepted_by" UUID,
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "ai_handoffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_summaries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "summary" TEXT NOT NULL,
    "model_version" VARCHAR(100),
    "generated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_suggestions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "suggestion" TEXT NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    "final_content" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "callback_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "assigned_agent_id" UUID,
    "created_by" UUID,
    "scheduled_at" TIMESTAMPTZ(6) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "completion_note" TEXT,
    "reminder_sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "callback_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calls" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "initiated_by_type" VARCHAR(30) NOT NULL,
    "initiated_by_id" UUID NOT NULL,
    "call_type" VARCHAR(20) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'INITIATING',
    "started_at" TIMESTAMPTZ(6),
    "ended_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_participants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "call_id" UUID NOT NULL,
    "participant_type" VARCHAR(30) NOT NULL,
    "participant_id" UUID NOT NULL,
    "joined_at" TIMESTAMPTZ(6),
    "left_at" TIMESTAMPTZ(6),

    CONSTRAINT "call_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spam_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "reported_by_type" VARCHAR(30) NOT NULL,
    "reported_by_id" UUID NOT NULL,
    "message_id" UUID,
    "reason" TEXT NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "resolution_note" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spam_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_blocks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "blocked_by" UUID NOT NULL,
    "reason" TEXT,
    "blocked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unblocked_at" TIMESTAMPTZ(6),
    "unblocked_by" UUID,

    CONSTRAINT "customer_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blocked_keywords" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "keyword" VARCHAR(255) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blocked_keywords_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moderation_activities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_id" UUID NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "target_type" VARCHAR(50) NOT NULL,
    "target_id" UUID NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moderation_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_devices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "platform" VARCHAR(30) NOT NULL,
    "device_token" VARCHAR(512) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_seen_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_preferences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agent_id" UUID NOT NULL,
    "layout" JSONB,
    "sidebar_width" INTEGER,
    "settings" JSONB,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_open_conversations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agent_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "last_opened_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_open_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_chat_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "typing_sound_enabled" BOOLEAN NOT NULL DEFAULT true,
    "notification_sound_enabled" BOOLEAN NOT NULL DEFAULT true,
    "ai_suggestions_enabled" BOOLEAN NOT NULL DEFAULT true,
    "ai_summaries_enabled" BOOLEAN NOT NULL DEFAULT true,
    "auto_assign_enabled" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_chat_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversations_status_last_message_at_idx" ON "conversations"("status", "last_message_at");

-- CreateIndex
CREATE INDEX "conversations_customer_id_idx" ON "conversations"("customer_id");

-- CreateIndex
CREATE INDEX "conversations_application_id_idx" ON "conversations"("application_id");

-- CreateIndex
CREATE INDEX "conversations_priority_last_message_at_idx" ON "conversations"("priority", "last_message_at");

-- CreateIndex
CREATE INDEX "conversations_assigned_agent_id_last_message_at_idx" ON "conversations"("assigned_agent_id", "last_message_at");

-- CreateIndex
CREATE INDEX "conversations_is_archived_last_message_at_idx" ON "conversations"("is_archived", "last_message_at");

-- CreateIndex
CREATE INDEX "conversations_conversation_type_idx" ON "conversations"("conversation_type");

-- CreateIndex
CREATE INDEX "conversation_participants_conversation_id_idx" ON "conversation_participants"("conversation_id");

-- CreateIndex
CREATE INDEX "conversation_participants_participant_type_participant_id_idx" ON "conversation_participants"("participant_type", "participant_id");

-- CreateIndex
CREATE INDEX "conversation_assignments_conversation_id_ended_at_idx" ON "conversation_assignments"("conversation_id", "ended_at");

-- CreateIndex
CREATE INDEX "conversation_assignments_agent_id_ended_at_idx" ON "conversation_assignments"("agent_id", "ended_at");

-- CreateIndex
CREATE INDEX "conversation_activities_conversation_id_created_at_idx" ON "conversation_activities"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "conversation_activities_conversation_id_activity_type_idx" ON "conversation_activities"("conversation_id", "activity_type");

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_sender_type_sender_id_idx" ON "messages"("sender_type", "sender_id");

-- CreateIndex
CREATE INDEX "messages_reply_to_message_id_idx" ON "messages"("reply_to_message_id");

-- CreateIndex
CREATE INDEX "messages_forwarded_from_message_id_idx" ON "messages"("forwarded_from_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "messages_conversation_id_sequence_number_key" ON "messages"("conversation_id", "sequence_number");

-- CreateIndex
CREATE UNIQUE INDEX "messages_conversation_id_client_id_key" ON "messages"("conversation_id", "client_id");

-- CreateIndex
CREATE UNIQUE INDEX "messages_id_conversation_key" ON "messages"("id", "conversation_id");

-- CreateIndex
CREATE INDEX "message_receipts_recipient_type_recipient_id_read_at_idx" ON "message_receipts"("recipient_type", "recipient_id", "read_at");

-- CreateIndex
CREATE UNIQUE INDEX "message_receipts_message_id_recipient_type_recipient_id_key" ON "message_receipts"("message_id", "recipient_type", "recipient_id");

-- CreateIndex
CREATE INDEX "conversation_reads_last_read_message_id_idx" ON "conversation_reads"("last_read_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_reads_conversation_id_reader_type_reader_id_key" ON "conversation_reads"("conversation_id", "reader_type", "reader_id");

-- CreateIndex
CREATE INDEX "message_edit_history_message_id_edited_at_idx" ON "message_edit_history"("message_id", "edited_at");

-- CreateIndex
CREATE UNIQUE INDEX "message_reactions_message_id_user_type_user_id_emoji_key" ON "message_reactions"("message_id", "user_type", "user_id", "emoji");

-- CreateIndex
CREATE UNIQUE INDEX "attachments_storage_key_key" ON "attachments"("storage_key");

-- CreateIndex
CREATE INDEX "attachments_conversation_id_created_at_idx" ON "attachments"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "attachments_uploaded_by_type_uploaded_by_id_idx" ON "attachments"("uploaded_by_type", "uploaded_by_id");

-- CreateIndex
CREATE INDEX "attachments_upload_status_created_at_idx" ON "attachments"("upload_status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "attachments_id_conversation_key" ON "attachments"("id", "conversation_id");

-- CreateIndex
CREATE INDEX "message_attachments_conversation_id_idx" ON "message_attachments"("conversation_id");

-- CreateIndex
CREATE INDEX "message_attachments_attachment_id_idx" ON "message_attachments"("attachment_id");

-- CreateIndex
CREATE INDEX "internal_notes_conversation_id_created_at_idx" ON "internal_notes"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "note_mentions_mentioned_agent_id_idx" ON "note_mentions"("mentioned_agent_id");

-- CreateIndex
CREATE UNIQUE INDEX "note_mentions_note_id_mentioned_agent_id_key" ON "note_mentions"("note_id", "mentioned_agent_id");

-- CreateIndex
CREATE INDEX "conversation_escalations_conversation_id_status_idx" ON "conversation_escalations"("conversation_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tags_name_key" ON "tags"("name");

-- CreateIndex
CREATE INDEX "conversation_tags_tag_id_idx" ON "conversation_tags"("tag_id");

-- CreateIndex
CREATE INDEX "notifications_recipient_type_recipient_id_created_at_idx" ON "notifications"("recipient_type", "recipient_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_recipient_type_recipient_id_read_at_idx" ON "notifications"("recipient_type", "recipient_id", "read_at");

-- CreateIndex
CREATE INDEX "notifications_conversation_id_idx" ON "notifications"("conversation_id");

-- CreateIndex
CREATE INDEX "notifications_message_id_idx" ON "notifications"("message_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_agent_id_key" ON "notification_preferences"("agent_id");

-- CreateIndex
CREATE INDEX "conversation_notification_settings_agent_id_idx" ON "conversation_notification_settings"("agent_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_notification_settings_conversation_id_agent_id_key" ON "conversation_notification_settings"("conversation_id", "agent_id");

-- CreateIndex
CREATE INDEX "agent_presence_history_agent_id_ended_at_idx" ON "agent_presence_history"("agent_id", "ended_at");

-- CreateIndex
CREATE INDEX "canned_responses_created_by_is_active_idx" ON "canned_responses"("created_by", "is_active");

-- CreateIndex
CREATE INDEX "canned_responses_team_id_is_active_idx" ON "canned_responses"("team_id", "is_active");

-- CreateIndex
CREATE INDEX "automation_rules_is_active_trigger_type_priority_idx" ON "automation_rules"("is_active", "trigger_type", "priority");

-- CreateIndex
CREATE INDEX "automation_logs_rule_id_created_at_idx" ON "automation_logs"("rule_id", "created_at");

-- CreateIndex
CREATE INDEX "automation_logs_conversation_id_idx" ON "automation_logs"("conversation_id");

-- CreateIndex
CREATE INDEX "automation_logs_message_id_idx" ON "automation_logs"("message_id");

-- CreateIndex
CREATE INDEX "ai_handoffs_conversation_id_status_idx" ON "ai_handoffs"("conversation_id", "status");

-- CreateIndex
CREATE INDEX "ai_summaries_conversation_id_generated_at_idx" ON "ai_summaries"("conversation_id", "generated_at");

-- CreateIndex
CREATE INDEX "ai_suggestions_conversation_id_agent_id_idx" ON "ai_suggestions"("conversation_id", "agent_id");

-- CreateIndex
CREATE INDEX "callback_requests_assigned_agent_id_status_scheduled_at_idx" ON "callback_requests"("assigned_agent_id", "status", "scheduled_at");

-- CreateIndex
CREATE INDEX "callback_requests_status_scheduled_at_idx" ON "callback_requests"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "callback_requests_conversation_id_idx" ON "callback_requests"("conversation_id");

-- CreateIndex
CREATE INDEX "callback_requests_customer_id_idx" ON "callback_requests"("customer_id");

-- CreateIndex
CREATE INDEX "calls_conversation_id_created_at_idx" ON "calls"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "call_participants_participant_type_participant_id_idx" ON "call_participants"("participant_type", "participant_id");

-- CreateIndex
CREATE UNIQUE INDEX "call_participants_call_id_participant_type_participant_id_key" ON "call_participants"("call_id", "participant_type", "participant_id");

-- CreateIndex
CREATE INDEX "spam_reports_status_created_at_idx" ON "spam_reports"("status", "created_at");

-- CreateIndex
CREATE INDEX "spam_reports_conversation_id_idx" ON "spam_reports"("conversation_id");

-- CreateIndex
CREATE INDEX "spam_reports_message_id_idx" ON "spam_reports"("message_id");

-- CreateIndex
CREATE INDEX "customer_blocks_customer_id_unblocked_at_idx" ON "customer_blocks"("customer_id", "unblocked_at");

-- CreateIndex
CREATE UNIQUE INDEX "blocked_keywords_keyword_key" ON "blocked_keywords"("keyword");

-- CreateIndex
CREATE INDEX "moderation_activities_actor_id_created_at_idx" ON "moderation_activities"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "moderation_activities_target_type_target_id_idx" ON "moderation_activities"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "push_devices_user_id_idx" ON "push_devices"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "push_devices_platform_device_token_key" ON "push_devices"("platform", "device_token");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_preferences_agent_id_key" ON "workspace_preferences"("agent_id");

-- CreateIndex
CREATE INDEX "workspace_open_conversations_conversation_id_idx" ON "workspace_open_conversations"("conversation_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_open_conversations_agent_id_conversation_id_key" ON "workspace_open_conversations"("agent_id", "conversation_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_chat_settings_user_id_key" ON "user_chat_settings"("user_id");

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_assignments" ADD CONSTRAINT "conversation_assignments_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_activities" ADD CONSTRAINT "conversation_activities_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_reply_to_message_id_conversation_id_fkey" FOREIGN KEY ("reply_to_message_id", "conversation_id") REFERENCES "messages"("id", "conversation_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_forwarded_from_message_id_fkey" FOREIGN KEY ("forwarded_from_message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_receipts" ADD CONSTRAINT "message_receipts_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_reads" ADD CONSTRAINT "conversation_reads_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_reads" ADD CONSTRAINT "conversation_reads_last_read_message_id_conversation_id_fkey" FOREIGN KEY ("last_read_message_id", "conversation_id") REFERENCES "messages"("id", "conversation_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_edit_history" ADD CONSTRAINT "message_edit_history_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_message_id_conversation_id_fkey" FOREIGN KEY ("message_id", "conversation_id") REFERENCES "messages"("id", "conversation_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_attachment_id_conversation_id_fkey" FOREIGN KEY ("attachment_id", "conversation_id") REFERENCES "attachments"("id", "conversation_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_notes" ADD CONSTRAINT "internal_notes_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note_mentions" ADD CONSTRAINT "note_mentions_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "internal_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_escalations" ADD CONSTRAINT "conversation_escalations_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_tags" ADD CONSTRAINT "conversation_tags_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_tags" ADD CONSTRAINT "conversation_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_notification_settings" ADD CONSTRAINT "conversation_notification_settings_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_logs" ADD CONSTRAINT "automation_logs_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "automation_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_logs" ADD CONSTRAINT "automation_logs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_logs" ADD CONSTRAINT "automation_logs_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_handoffs" ADD CONSTRAINT "ai_handoffs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_summaries" ADD CONSTRAINT "ai_summaries_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "callback_requests" ADD CONSTRAINT "callback_requests_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_participants" ADD CONSTRAINT "call_participants_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spam_reports" ADD CONSTRAINT "spam_reports_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spam_reports" ADD CONSTRAINT "spam_reports_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_open_conversations" ADD CONSTRAINT "workspace_open_conversations_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- PostgreSQL 16+ constraints Prisma cannot express. Append to the first generated
-- migration (prisma migrate dev --create-only, then paste this into migration.sql).
-- Table and column names follow docs/database-schema.dbml (Backend 2 only).

-- ─── Value sets (no database enums) ─────────────────────────────────────────
-- PROPOSED sets: the DBML only names some of them in column notes. Confirm or change them here and in
-- docs/database-schema.md before the first migration. NULL passes a CHECK, so nullable columns stay nullable.

ALTER TABLE conversations ADD CONSTRAINT conversations_conversation_type_check CHECK (conversation_type IN ('CUSTOMER_SUPPORT', 'INTERNAL'));
ALTER TABLE conversations ADD CONSTRAINT conversations_channel_check CHECK (channel IN ('web', 'mobile'));
ALTER TABLE conversations ADD CONSTRAINT conversations_created_by_type_check CHECK (created_by_type IN ('CUSTOMER', 'AGENT'));
ALTER TABLE conversations ADD CONSTRAINT conversations_status_check CHECK (status IN ('OPEN', 'RESOLVED', 'CLOSED'));
ALTER TABLE conversations ADD CONSTRAINT conversations_priority_check CHECK (priority IN ('HIGH', 'MEDIUM', 'LOW'));
ALTER TABLE conversations ADD CONSTRAINT conversations_conversation_mode_check CHECK (conversation_mode IN ('AI', 'HUMAN'));
ALTER TABLE conversations ADD CONSTRAINT conversations_handoff_status_check CHECK (handoff_status IN ('NONE', 'NEEDS_HUMAN', 'ASSIGNED'));

ALTER TABLE conversation_participants ADD CONSTRAINT conversation_participants_participant_type_check CHECK (participant_type IN ('CUSTOMER', 'AGENT', 'ASSISTANT'));
ALTER TABLE conversation_participants ADD CONSTRAINT conversation_participants_participant_role_check CHECK (participant_role IN ('OWNER', 'VIEWER', 'MEMBER'));
ALTER TABLE conversation_assignments ADD CONSTRAINT conversation_assignments_assignment_type_check CHECK (assignment_type IN ('OWNER', 'VIEWER'));
ALTER TABLE conversation_assignments ADD CONSTRAINT conversation_assignments_assignment_action_check CHECK (assignment_action IN ('TAKEOVER', 'ASSIGNED', 'TRANSFERRED', 'AUTO_ASSIGNED'));
ALTER TABLE conversation_activities ADD CONSTRAINT conversation_activities_activity_type_check CHECK (activity_type IN (
  'STATUS_CHANGED', 'PRIORITY_CHANGED', 'ASSIGNED', 'TRANSFERRED', 'UNASSIGNED', 'ESCALATED', 'HANDOFF_REQUESTED',
  'HANDOFF_ACCEPTED', 'TAG_ADDED', 'TAG_REMOVED', 'ARCHIVED', 'RESTORED', 'NOTE_ADDED', 'CALL', 'CALLBACK', 'MODERATION'
));
ALTER TABLE conversation_activities ADD CONSTRAINT conversation_activities_actor_type_check CHECK (actor_type IN ('CUSTOMER', 'AGENT', 'ASSISTANT', 'SYSTEM'));

ALTER TABLE messages ADD CONSTRAINT messages_sender_type_check CHECK (sender_type IN ('CUSTOMER', 'AGENT', 'ASSISTANT', 'SYSTEM'));
ALTER TABLE messages ADD CONSTRAINT messages_message_type_check CHECK (message_type IN ('TEXT', 'IMAGE', 'FILE', 'AUDIO', 'VIDEO', 'VOICE', 'SYSTEM'));
ALTER TABLE messages ADD CONSTRAINT messages_status_check CHECK (status IN ('SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED'));
ALTER TABLE message_receipts ADD CONSTRAINT message_receipts_recipient_type_check CHECK (recipient_type IN ('CUSTOMER', 'AGENT'));
ALTER TABLE conversation_reads ADD CONSTRAINT conversation_reads_reader_type_check CHECK (reader_type IN ('CUSTOMER', 'AGENT'));
ALTER TABLE message_edit_history ADD CONSTRAINT message_edit_history_editor_type_check CHECK (editor_type IN ('CUSTOMER', 'AGENT'));
ALTER TABLE message_reactions ADD CONSTRAINT message_reactions_user_type_check CHECK (user_type IN ('CUSTOMER', 'AGENT'));

ALTER TABLE attachments ADD CONSTRAINT attachments_uploaded_by_type_check CHECK (uploaded_by_type IN ('CUSTOMER', 'AGENT'));
ALTER TABLE attachments ADD CONSTRAINT attachments_upload_status_check CHECK (upload_status IN ('PENDING', 'UPLOADED', 'FAILED'));

ALTER TABLE conversation_escalations ADD CONSTRAINT conversation_escalations_status_check CHECK (status IN ('PENDING', 'RESOLVED', 'CANCELLED'));
ALTER TABLE notifications ADD CONSTRAINT notifications_notification_type_check CHECK (notification_type IN (
  'NEW_MESSAGE', 'NEW_CONVERSATION', 'HANDOFF', 'ASSIGNED', 'TRANSFERRED', 'MENTION', 'CALLBACK', 'CALL', 'SYSTEM'
));
ALTER TABLE notifications ADD CONSTRAINT notifications_recipient_type_check CHECK (recipient_type IN ('CUSTOMER', 'AGENT'));
ALTER TABLE agent_presence_history ADD CONSTRAINT agent_presence_history_status_check CHECK (status IN ('AVAILABLE', 'BUSY', 'AWAY', 'OFFLINE'));
ALTER TABLE canned_responses ADD CONSTRAINT canned_responses_scope_check CHECK (scope IN ('PERSONAL', 'TEAM'));
ALTER TABLE automation_logs ADD CONSTRAINT automation_logs_execution_status_check CHECK (execution_status IN ('SUCCESS', 'FAILED', 'SKIPPED'));

ALTER TABLE ai_handoffs ADD CONSTRAINT ai_handoffs_requested_by_type_check CHECK (requested_by_type IN ('AI', 'CUSTOMER', 'AGENT', 'SYSTEM'));
ALTER TABLE ai_handoffs ADD CONSTRAINT ai_handoffs_status_check CHECK (status IN ('PENDING', 'ACCEPTED', 'COMPLETED', 'CANCELLED'));
ALTER TABLE ai_suggestions ADD CONSTRAINT ai_suggestions_status_check CHECK (status IN ('PENDING', 'ACCEPTED', 'EDITED', 'DISMISSED'));

ALTER TABLE callback_requests ADD CONSTRAINT callback_requests_status_check CHECK (status IN ('PENDING', 'COMPLETED', 'CANCELLED', 'MISSED'));
ALTER TABLE calls ADD CONSTRAINT calls_initiated_by_type_check CHECK (initiated_by_type IN ('CUSTOMER', 'AGENT'));
ALTER TABLE calls ADD CONSTRAINT calls_call_type_check CHECK (call_type IN ('AUDIO', 'VIDEO'));
ALTER TABLE calls ADD CONSTRAINT calls_status_check CHECK (status IN ('INITIATING', 'RINGING', 'ACTIVE', 'ENDED', 'DECLINED', 'MISSED', 'CANCELLED', 'FAILED'));
ALTER TABLE call_participants ADD CONSTRAINT call_participants_participant_type_check CHECK (participant_type IN ('CUSTOMER', 'AGENT'));

ALTER TABLE spam_reports ADD CONSTRAINT spam_reports_reported_by_type_check CHECK (reported_by_type IN ('CUSTOMER', 'AGENT'));
ALTER TABLE spam_reports ADD CONSTRAINT spam_reports_status_check CHECK (status IN ('PENDING', 'CONFIRMED', 'DISMISSED'));
ALTER TABLE moderation_activities ADD CONSTRAINT moderation_activities_target_type_check CHECK (target_type IN ('CUSTOMER', 'CONVERSATION', 'MESSAGE', 'KEYWORD', 'SPAM_REPORT'));
ALTER TABLE push_devices ADD CONSTRAINT push_devices_platform_check CHECK (platform IN ('ANDROID', 'IOS'));

-- ─── Consistency rules ──────────────────────────────────────────────────────

-- is_archived and archived_at agree.
ALTER TABLE conversations ADD CONSTRAINT conversations_archived_matches_flag CHECK (is_archived = (archived_at IS NOT NULL));

-- An OPEN conversation has no resolved/closed time; RESOLVED and CLOSED carry theirs.
ALTER TABLE conversations ADD CONSTRAINT conversations_timestamps_match_status CHECK (
  (status <> 'OPEN' OR (resolved_at IS NULL AND closed_at IS NULL))
  AND (status <> 'RESOLVED' OR resolved_at IS NOT NULL)
  AND (status <> 'CLOSED' OR closed_at IS NOT NULL)
);

-- The denormalized owner agrees with the handoff state: ASSIGNED <=> an agent is set.
ALTER TABLE conversations ADD CONSTRAINT conversations_assigned_agent_matches_handoff CHECK (
  (handoff_status = 'ASSIGNED') = (assigned_agent_id IS NOT NULL)
);

-- Customer support chats belong to a customer; internal chats do not.
ALTER TABLE conversations ADD CONSTRAINT conversations_customer_required CHECK (
  conversation_type <> 'CUSTOMER_SUPPORT' OR customer_id IS NOT NULL
);

-- created_by_type and created_by_id are set together.
ALTER TABLE conversations ADD CONSTRAINT conversations_created_by_matches CHECK (
  (created_by_type IS NULL) = (created_by_id IS NULL)
);

-- handoff_status ASSIGNED requires human mode.
ALTER TABLE conversations ADD CONSTRAINT conversations_assigned_means_human CHECK (
  handoff_status <> 'ASSIGNED' OR conversation_mode = 'HUMAN'
);

-- SYSTEM messages have no sender id; CUSTOMER and AGENT messages must have one (ASSISTANT may or may not).
ALTER TABLE messages ADD CONSTRAINT messages_sender_matches_type CHECK (
  sender_type = 'ASSISTANT' OR (sender_type = 'SYSTEM') = (sender_id IS NULL)
);

-- Message numbers start at 1. (Replies and last-read markers stay in the same conversation through the composite
-- foreign keys (x_message_id, conversation_id) -> messages (id, conversation_id) declared in schema.prisma.)
ALTER TABLE messages ADD CONSTRAINT messages_sequence_positive CHECK (sequence_number > 0);

-- Sizes, durations and counters are never negative.
ALTER TABLE attachments ADD CONSTRAINT attachments_file_size_nonnegative CHECK (file_size >= 0);
ALTER TABLE attachments ADD CONSTRAINT attachments_duration_nonnegative CHECK (duration_ms IS NULL OR duration_ms >= 0);
ALTER TABLE conversations ADD CONSTRAINT conversations_last_sequence_nonnegative CHECK (last_sequence_number >= 0);
ALTER TABLE conversation_reads ADD CONSTRAINT conversation_reads_last_read_sequence_nonnegative CHECK (last_read_sequence_number >= 0);
ALTER TABLE workspace_preferences ADD CONSTRAINT workspace_preferences_sidebar_width_positive CHECK (sidebar_width IS NULL OR sidebar_width > 0);

-- The assistant has no Backend 1 id; every other participant does.
ALTER TABLE conversation_participants ADD CONSTRAINT conversation_participants_assistant_has_no_id CHECK (
  (participant_type = 'ASSISTANT') = (participant_id IS NULL)
);

-- Derived flags agree with the timestamps they summarize.
ALTER TABLE messages ADD CONSTRAINT messages_edited_matches_flag CHECK (is_edited = (edited_at IS NOT NULL));
ALTER TABLE messages ADD CONSTRAINT messages_deleted_by_needs_deleted CHECK (deleted_by IS NULL OR deleted_at IS NOT NULL);

-- A message is read after it is delivered (either may be missing).
ALTER TABLE message_receipts ADD CONSTRAINT message_receipts_read_after_delivered CHECK (
  read_at IS NULL OR delivered_at IS NULL OR read_at >= delivered_at
);

-- Time ranges must not run backwards.
ALTER TABLE conversation_assignments ADD CONSTRAINT conversation_assignments_end_after_start CHECK (ended_at IS NULL OR ended_at >= assigned_at);
ALTER TABLE conversation_participants ADD CONSTRAINT conversation_participants_left_after_joined CHECK (left_at IS NULL OR left_at >= joined_at);

-- Plain text messages carry content (attachment/voice messages may not).
ALTER TABLE messages ADD CONSTRAINT messages_text_has_content CHECK (message_type <> 'TEXT' OR content IS NOT NULL);

-- A TEAM template names its team; a personal one does not.
ALTER TABLE canned_responses ADD CONSTRAINT canned_responses_team_matches_scope CHECK (
  (scope = 'TEAM') = (team_id IS NOT NULL)
);

-- At most one non-closed conversation per loan application.
CREATE UNIQUE INDEX conversations_one_open_per_application
  ON conversations (application_id)
  WHERE application_id IS NOT NULL AND status <> 'CLOSED';

-- A participant is in a conversation at most once at a time.
CREATE UNIQUE INDEX conversation_participants_one_active
  ON conversation_participants (conversation_id, participant_type, coalesce(participant_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE left_at IS NULL;

-- At most one pending AI handoff per conversation.
CREATE UNIQUE INDEX ai_handoffs_one_pending
  ON ai_handoffs (conversation_id)
  WHERE status = 'PENDING';

-- One active OWNER per conversation (race-safe takeover/assign relies on this).
CREATE UNIQUE INDEX conversation_assignments_one_active_owner
  ON conversation_assignments (conversation_id)
  WHERE ended_at IS NULL AND assignment_type = 'OWNER';

-- At most one pending escalation per conversation.
CREATE UNIQUE INDEX conversation_escalations_one_pending
  ON conversation_escalations (conversation_id)
  WHERE status = 'PENDING';

-- An agent has at most one open presence period.
CREATE UNIQUE INDEX agent_presence_history_one_open
  ON agent_presence_history (agent_id)
  WHERE ended_at IS NULL;

-- At most one active block per customer.
CREATE UNIQUE INDEX customer_blocks_one_active
  ON customer_blocks (customer_id)
  WHERE unblocked_at IS NULL;

-- Call and callback timestamps must be consistent.
ALTER TABLE calls ADD CONSTRAINT calls_end_after_start CHECK (ended_at IS NULL OR started_at IS NULL OR ended_at >= started_at);
ALTER TABLE callback_requests ADD CONSTRAINT callback_requests_completed_matches_status CHECK (
  (status = 'COMPLETED') = (completed_at IS NOT NULL)
);

-- ─── Denormalization guard ──────────────────────────────────────────────────
-- conversations.assigned_agent_id mirrors the open OWNER row of conversation_assignments. The two are written in
-- one transaction by the service; this deferred constraint trigger makes the database refuse to COMMIT if they
-- disagree, so the inbox filters can never drift from the assignment history.

CREATE FUNCTION assert_conversation_owner_consistent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  conv_id  uuid;
  actual   uuid;
  expected uuid;
BEGIN
  IF TG_TABLE_NAME = 'conversations' THEN conv_id := NEW.id; ELSE conv_id := NEW.conversation_id; END IF;

  SELECT assigned_agent_id INTO actual FROM conversations WHERE id = conv_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT agent_id INTO expected
    FROM conversation_assignments
   WHERE conversation_id = conv_id AND ended_at IS NULL AND assignment_type = 'OWNER';

  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'conversation % assigned_agent_id (%) does not match its open OWNER assignment (%)',
      conv_id, actual, expected USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER conversations_owner_consistent
  AFTER INSERT OR UPDATE OF assigned_agent_id ON conversations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_conversation_owner_consistent();

CREATE CONSTRAINT TRIGGER assignments_owner_consistent
  AFTER INSERT OR UPDATE OF agent_id, ended_at, assignment_type ON conversation_assignments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_conversation_owner_consistent();

-- ─── Hot-path partial indexes ───────────────────────────────────────────────

-- The shared queue (Unassigned filter): conversations waiting for a human.
CREATE INDEX conversations_queue_idx
  ON conversations (last_message_at DESC)
  WHERE handoff_status = 'NEEDS_HUMAN' AND is_archived = false;

-- Unread notification badge and list.
CREATE INDEX notifications_unread_idx
  ON notifications (recipient_type, recipient_id, created_at DESC)
  WHERE read_at IS NULL;

-- ─── Search and case-insensitive uniqueness ─────────────────────────────────

-- Inbox search by customer name prefix (case-insensitive).
CREATE INDEX conversations_customer_name_lower
  ON conversations (lower(customer_name) text_pattern_ops);

-- Search-in-chat: full-text index on message content.
CREATE INDEX messages_content_fts ON messages USING GIN (to_tsvector('simple', coalesce(content, '')));

-- Tag names and blocked keywords are unique ignoring case (the plain UNIQUE from the schema also stays).
CREATE UNIQUE INDEX tags_name_lower_key ON tags (lower(name));
CREATE UNIQUE INDEX blocked_keywords_keyword_lower_key ON blocked_keywords (lower(keyword));
