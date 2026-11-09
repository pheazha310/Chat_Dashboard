-- Lets the session cleanup job (AUTH_SESSION_CLEANUP_INTERVAL_MINUTES) find expired sessions without a full scan.
CREATE INDEX "auth_sessions_expires_at_idx" ON "auth_sessions"("expires_at");
