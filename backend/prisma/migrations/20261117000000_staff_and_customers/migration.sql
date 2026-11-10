-- Staff and customer profile tables: the fields only one kind of account has, 1:1 with users (same id). Sign-in,
-- tokens and every other table keep using users.id. Loan data stays in Backend 1.

-- CreateTable
CREATE TABLE "staff" (
    "user_id" UUID NOT NULL,
    "employee_code" VARCHAR(100),
    "department" VARCHAR(100),
    "max_concurrent_chats" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "customers" (
    "user_id" UUID NOT NULL,
    "phone" VARCHAR(30),
    "customer_code" VARCHAR(100),
    "preferred_language" VARCHAR(10),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_employee_code_key" ON "staff"("employee_code");

-- CreateIndex
CREATE UNIQUE INDEX "customers_customer_code_key" ON "customers"("customer_code");

-- AddForeignKey
ALTER TABLE "staff" ADD CONSTRAINT "staff_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Value rules (also in prisma/sql/constraints.sql).
ALTER TABLE staff ADD CONSTRAINT staff_max_concurrent_chats_positive CHECK (max_concurrent_chats > 0);
ALTER TABLE customers ADD CONSTRAINT customers_phone_e164 CHECK (phone ~ '^\+[1-9][0-9]{6,14}$');

-- Every existing account gets its profile row (the application creates it with each new account from now on).
INSERT INTO staff (user_id) SELECT id FROM users WHERE role <> 'CUSTOMER';
INSERT INTO customers (user_id) SELECT id FROM users WHERE role = 'CUSTOMER';
