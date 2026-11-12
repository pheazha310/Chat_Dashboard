-- Sign in with a username and password instead of an email. `email` stays as an optional contact address.
ALTER TABLE "users" ADD COLUMN "username" VARCHAR(32);

-- Backfill: the part of the email before "@", lower-cased, other characters replaced by "_", at least 3 characters
-- (padded with 0) and starting with a letter or digit; a later account with the same name gets "-2", "-3", ...
WITH base AS (
  SELECT id, created_at,
         CASE WHEN b ~ '^[a-z0-9]' THEN b ELSE 'u' || b END AS b
  FROM (
    SELECT id, created_at,
           rpad(left(regexp_replace(lower(split_part(email, '@', 1)), '[^a-z0-9._-]', '_', 'g'), 24), 3, '0') AS b
    FROM "users" WHERE email IS NOT NULL
  ) raw
),
ranked AS (
  SELECT id, b, row_number() OVER (PARTITION BY b ORDER BY created_at, id) AS n FROM base
)
UPDATE "users" u
SET "username" = CASE WHEN ranked.n = 1 THEN ranked.b ELSE ranked.b || '-' || ranked.n END
FROM ranked WHERE u.id = ranked.id;

CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

ALTER TABLE users ADD CONSTRAINT users_username_format_check CHECK (username ~ '^[a-z0-9][a-z0-9._-]{2,31}$');
ALTER TABLE users DROP CONSTRAINT users_password_needs_email;
ALTER TABLE users DROP CONSTRAINT users_has_sign_in;
ALTER TABLE users ADD CONSTRAINT users_password_needs_username CHECK ((username IS NULL) = (password_hash IS NULL));
ALTER TABLE users ADD CONSTRAINT users_has_sign_in CHECK (username IS NOT NULL OR los_user_id IS NOT NULL);
