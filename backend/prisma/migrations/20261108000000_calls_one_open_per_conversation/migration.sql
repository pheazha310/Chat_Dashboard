-- A conversation has at most one call that is not over (ringing or in progress). The service checks first for a clear
-- message; this index settles two simultaneous attempts and keeps a stale row from ever allowing a second call.
CREATE UNIQUE INDEX calls_one_open_per_conversation
  ON calls (conversation_id)
  WHERE status IN ('INITIATING', 'RINGING', 'ACTIVE');
