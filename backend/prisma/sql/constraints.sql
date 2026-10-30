-- MySQL 8.0.16+ constraints Prisma cannot express. Append to the first generated
-- migration (prisma migrate dev --create-only, then paste this into migration.sql).

-- One active OWNER per conversation. MySQL has no partial unique indexes, so a
-- generated column holds the conversation id only while the row is the active
-- owner (NULL otherwise), and a UNIQUE index on it does the enforcing.
-- (NULLs never collide in a MySQL UNIQUE index.)
ALTER TABLE agent_conversations
  MODIFY active_owner_key CHAR(36)
    GENERATED ALWAYS AS (IF(unassigned_at IS NULL AND role = 'OWNER', conversation_id, NULL)) STORED,
  ADD UNIQUE INDEX agent_conversations_one_active_owner (active_owner_key);

-- ASSISTANT messages have no sender; CUSTOMER and AGENT messages must have one.
-- (That the user's role matches sender_type is checked in the application.)
ALTER TABLE messages ADD CONSTRAINT messages_sender_matches_type CHECK (
  (sender_type = 'ASSISTANT') = (sender_user_id IS NULL)
);

-- handoff and assignee must agree: ASSIGNED <=> an agent is set.
ALTER TABLE conversations ADD CONSTRAINT conversations_handoff_matches_assignee CHECK (
  (handoff = 'ASSIGNED') = (assigned_agent_id IS NOT NULL)
);

-- closed_at is set exactly when the conversation is no longer OPEN.
ALTER TABLE conversations ADD CONSTRAINT conversations_closed_at_matches_status CHECK (
  (status = 'OPEN') = (closed_at IS NULL)
);
