-- Single-use LOS staff hand-off tokens: the `jti` of each token that signed someone in. The primary key makes the
-- claim atomic across API instances (INSERT ... ON CONFLICT DO NOTHING).

-- CreateTable
CREATE TABLE "los_handoff_tokens" (
    "jti" VARCHAR(200) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "los_handoff_tokens_pkey" PRIMARY KEY ("jti")
);

-- CreateIndex
CREATE INDEX "los_handoff_tokens_expires_at_idx" ON "los_handoff_tokens"("expires_at");
