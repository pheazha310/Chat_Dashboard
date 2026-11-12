-- Six fields of a customer's latest LOS application, read with the customer's own LOS token at sign-in.
-- CreateTable
CREATE TABLE "loan_application_snapshots" (
    "application_id" INTEGER NOT NULL,
    "customer_id" UUID NOT NULL,
    "status" VARCHAR(100) NOT NULL,
    "ticket_number" VARCHAR(100),
    "applied_date" VARCHAR(40),
    "loan_purpose" VARCHAR(255),
    "requested_loan_size" INTEGER,
    "requested_loan_term" INTEGER,
    "fetched_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loan_application_snapshots_pkey" PRIMARY KEY ("application_id")
);

-- CreateIndex
CREATE INDEX "loan_application_snapshots_customer_id_idx" ON "loan_application_snapshots"("customer_id");
