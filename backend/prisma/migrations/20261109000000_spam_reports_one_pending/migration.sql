-- The same reporter cannot have two pending reports about the same message (or two general reports about one
-- conversation). A message-less report counts as the nil UUID. Settles simultaneous duplicate reports.
CREATE UNIQUE INDEX spam_reports_pending_once
  ON spam_reports (reported_by_type, reported_by_id, conversation_id, COALESCE(message_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status = 'PENDING';
