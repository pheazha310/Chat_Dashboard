-- Explicit mapping from an outside provider's identity (LOS) to a chat account, and an audit trail of sign-ins.
CREATE TABLE "external_identities" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "provider" VARCHAR(20) NOT NULL,
  "external_user_id" VARCHAR(100) NOT NULL,
  "external_user_type" VARCHAR(20) NOT NULL,
  "chat_user_id" UUID NOT NULL,
  "linked_by" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "external_identities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "external_identities_chat_user_id_fkey" FOREIGN KEY ("chat_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "external_identities_provider_external_user_type_external_user_id_key"
  ON "external_identities"("provider", "external_user_type", "external_user_id");
CREATE UNIQUE INDEX "external_identities_chat_user_id_provider_key" ON "external_identities"("chat_user_id", "provider");
ALTER TABLE "external_identities" ADD CONSTRAINT external_identities_provider_check CHECK (provider IN ('LOS'));
ALTER TABLE "external_identities" ADD CONSTRAINT external_identities_type_check CHECK (external_user_type IN ('CUSTOMER', 'STAFF'));

-- Backfill: every account that already signs in through LOS.
INSERT INTO "external_identities" ("provider", "external_user_id", "external_user_type", "chat_user_id")
SELECT 'LOS', los_user_id::text, los_user_type, id FROM "users" WHERE los_user_id IS NOT NULL;

CREATE TABLE "auth_audit_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "event" VARCHAR(40) NOT NULL,
  "provider" VARCHAR(20) NOT NULL,
  "outcome" VARCHAR(10) NOT NULL,
  "user_id" UUID,
  "actor_id" UUID,
  "attempted_username" VARCHAR(32),
  "reason" VARCHAR(60),
  "ip_address" VARCHAR(45),
  "user_agent" VARCHAR(255),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "auth_audit_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "auth_audit_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "auth_audit_events_user_id_created_at_idx" ON "auth_audit_events"("user_id", "created_at");
CREATE INDEX "auth_audit_events_created_at_idx" ON "auth_audit_events"("created_at");
ALTER TABLE "auth_audit_events" ADD CONSTRAINT auth_audit_events_outcome_check CHECK (outcome IN ('SUCCESS', 'FAILURE'));
