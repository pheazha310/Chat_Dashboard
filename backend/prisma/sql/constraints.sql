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
ALTER TABLE canned_responses ADD CONSTRAINT canned_responses_scope_check CHECK (scope IN ('PERSONAL', 'TEAM', 'SHARED'));
ALTER TABLE automation_logs ADD CONSTRAINT automation_logs_execution_status_check CHECK (execution_status IN ('SUCCESS', 'FAILED', 'SKIPPED'));


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
ALTER TABLE conversation_drafts ADD CONSTRAINT conversation_drafts_content_length CHECK (char_length(content) BETWEEN 1 AND 10000);

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

-- A TEAM template names its team; personal and shared ones do not.
ALTER TABLE canned_responses ADD CONSTRAINT canned_responses_team_matches_scope CHECK (
  (scope = 'TEAM') = (team_id IS NOT NULL)
);

-- A shortcut means one template to whoever can see it (deactivating a template frees its shortcut).
CREATE UNIQUE INDEX canned_responses_personal_shortcut_key
  ON canned_responses (created_by, lower(shortcut))
  WHERE scope = 'PERSONAL' AND is_active AND shortcut IS NOT NULL;
CREATE UNIQUE INDEX canned_responses_shared_shortcut_key
  ON canned_responses (lower(shortcut))
  WHERE scope = 'SHARED' AND is_active AND shortcut IS NOT NULL;

-- At most one non-closed conversation per loan application.
CREATE UNIQUE INDEX conversations_one_open_per_application
  ON conversations (application_id)
  WHERE application_id IS NOT NULL AND status <> 'CLOSED';

-- A participant is in a conversation at most once at a time.
CREATE UNIQUE INDEX conversation_participants_one_active
  ON conversation_participants (conversation_id, participant_type, coalesce(participant_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE left_at IS NULL;

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

-- One pending report per reporter, conversation and message (a message-less report counts as the nil UUID).
CREATE UNIQUE INDEX spam_reports_pending_once
  ON spam_reports (reported_by_type, reported_by_id, conversation_id, COALESCE(message_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status = 'PENDING';

-- At most one active block per customer.
CREATE UNIQUE INDEX customer_blocks_one_active
  ON customer_blocks (customer_id)
  WHERE unblocked_at IS NULL;

-- A conversation has at most one call that is not over (ringing or in progress).
CREATE UNIQUE INDEX calls_one_open_per_conversation
  ON calls (conversation_id)
  WHERE status IN ('INITIATING', 'RINGING', 'ACTIVE');

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

-- Chat identity mapping.
ALTER TABLE chat_users ADD CONSTRAINT chat_users_user_type_check CHECK (user_type IN ('CUSTOMER', 'STAFF'));
ALTER TABLE chat_users ADD CONSTRAINT chat_users_role_check CHECK (role IN ('CUSTOMER', 'AGENT', 'SUPERVISOR', 'ADMIN'));
ALTER TABLE chat_users ADD CONSTRAINT chat_users_status_check CHECK (status IN ('ACTIVE', 'DISABLED'));
