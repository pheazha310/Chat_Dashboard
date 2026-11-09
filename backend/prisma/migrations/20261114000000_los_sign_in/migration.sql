-- Sign in with LOS: an account can be linked to its LOS user (los_user_type, los_user_id) and sign in with an LOS
-- token instead of a password. An LOS-only account has no email and no password hash.

ALTER TABLE "users" ADD COLUMN     "los_user_id" INTEGER,
ADD COLUMN     "los_user_type" VARCHAR(20),
ALTER COLUMN "email" DROP NOT NULL,
ALTER COLUMN "password_hash" DROP NOT NULL;

CREATE UNIQUE INDEX "users_los_user_type_los_user_id_key" ON "users"("los_user_type", "los_user_id");

-- A password always belongs to an email (and the other way round), and every account has a way to sign in.
ALTER TABLE users ADD CONSTRAINT users_password_needs_email CHECK ((email IS NULL) = (password_hash IS NULL));
ALTER TABLE users ADD CONSTRAINT users_has_sign_in CHECK (email IS NOT NULL OR los_user_id IS NOT NULL);
-- The LOS link is a pair; its kind matches the role (a CUSTOMER account is an LOS customer, staff are LOS staff).
ALTER TABLE users ADD CONSTRAINT users_los_link_pair CHECK ((los_user_id IS NULL) = (los_user_type IS NULL));
ALTER TABLE users ADD CONSTRAINT users_los_user_type_check CHECK (los_user_type IN ('CUSTOMER', 'STAFF'));
ALTER TABLE users ADD CONSTRAINT users_los_user_type_matches_role CHECK (los_user_type IS NULL OR (los_user_type = 'CUSTOMER') = (role = 'CUSTOMER'));
ALTER TABLE users ADD CONSTRAINT users_los_user_id_positive CHECK (los_user_id > 0);
