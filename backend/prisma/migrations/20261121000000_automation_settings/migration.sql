-- CreateTable
CREATE TABLE "ai_training_examples" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_message" TEXT NOT NULL,
    "suggested_reply" TEXT NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "created_by" UUID NOT NULL,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_training_examples_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_training_examples_status_created_at_idx" ON "ai_training_examples"("status", "created_at");

ALTER TABLE ai_training_examples ADD CONSTRAINT ai_training_examples_status_check CHECK (status IN ('PENDING', 'APPROVED'));
ALTER TABLE ai_training_examples ADD CONSTRAINT ai_training_examples_approval_check CHECK ((status = 'APPROVED') = (approved_by IS NOT NULL AND approved_at IS NOT NULL));

-- The team has one first-response and one away message: at most one rule per automatic-reply trigger.
CREATE UNIQUE INDEX automation_rules_one_auto_reply_per_trigger ON automation_rules (trigger_type) WHERE trigger_type IN ('FIRST_RESPONSE', 'AWAY');

-- New permission: edit the automatic replies and approve AI training examples (supervisors and admins).
INSERT INTO permissions (module, action, description) VALUES
  ('automation', 'manage', 'Edit the automatic replies and approve AI training examples');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM (VALUES
  ('SUPERVISOR', 'automation', 'manage'),
  ('ADMIN', 'automation', 'manage')
) AS g(role, module, action)
JOIN roles r ON r.name = g.role
JOIN permissions p ON p.module = g.module AND p.action = g.action;
