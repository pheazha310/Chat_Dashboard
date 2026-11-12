-- 20261124000000_username_sign_in padded names with rpad(x, 3, '0'), which also cuts longer names down to 3
-- characters ("admin@test.local" became "adm"). Redo the backfill for accounts that have an email: the part before "@",
-- lower-cased, other characters replaced by "_", at most 24 characters, padded with 0 to at least 3, starting with a
-- letter or digit; a later account with the same name gets "-2", "-3", ...
-- Parked on unique placeholders first so no two rows ever collide mid-update.
UPDATE "users" SET "username" = 'tmp' || substr(md5(id::text), 1, 12) WHERE email IS NOT NULL;

WITH base AS (
  SELECT id, created_at,
         CASE WHEN b ~ '^[a-z0-9]' THEN b ELSE 'u' || b END AS b
  FROM (
    SELECT id, created_at,
           CASE WHEN length(n) < 3 THEN n || repeat('0', 3 - length(n)) ELSE n END AS b
    FROM (
      SELECT id, created_at,
             left(regexp_replace(lower(split_part(email, '@', 1)), '[^a-z0-9._-]', '_', 'g'), 24) AS n
      FROM "users" WHERE email IS NOT NULL
    ) cut
  ) raw
),
ranked AS (
  SELECT id, b, row_number() OVER (PARTITION BY b ORDER BY created_at, id) AS n FROM base
)
UPDATE "users" u
SET "username" = CASE WHEN ranked.n = 1 THEN ranked.b ELSE ranked.b || '-' || ranked.n END
FROM ranked WHERE u.id = ranked.id;
