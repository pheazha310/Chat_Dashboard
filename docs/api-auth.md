# Authentication and accounts API

This backend owns sign-in for everyone: dashboard staff (`AGENT`, `SUPERVISOR`, `ADMIN`) and mobile customers
(`CUSTOMER`). It stores accounts and scrypt password hashes, issues access and refresh tokens, and manages accounts.
Interactive reference for the staff routes: `GET /api/v1/admin/openapi.json` (tags _Auth_ and _Users_). Envelope:
`{ "status": "success", "data": ... }`; errors `{ "status": "error", "error": { code, message, details? } }`.

## Tokens

| Token   | What it is                                                         | Lifetime                                  | Stored on the server                 |
| ------- | ------------------------------------------------------------------ | ----------------------------------------- | ------------------------------------ |
| Access  | HS256 JWT: `sub` = user id, `role`, `iss`/`aud` = `chat-dashboard` | `ACCESS_TOKEN_TTL_SECONDS` (900 = 15 min) | No (signed with `JWT_SECRET`)        |
| Refresh | 256 random bits, base64url, opaque                                 | `REFRESH_TOKEN_TTL_DAYS` (30)             | Only its SHA-256, in `auth_sessions` |

- Send the access token as `Authorization: Bearer <accessToken>` on REST, and in the first `auth` frame on `/ws`
  (`docs/websocket-events.md`). The user id in the token is `users.id`; it is the id every other table stores.
- **Refresh rotates.** `POST …/auth/refresh` revokes the presented refresh token and returns a new pair in the same
  sign-in (`family_id`). Presenting a refresh token that was already used (a stolen copy, or two tabs refreshing at once)
  revokes the whole sign-in: the user signs in again. **Clients must refresh one request at a time** and keep only the
  newest refresh token.
- An access token stays valid until it expires even after sign-out or a password change. It is, however, checked
  against its account on every request (the account is re-read at most once a minute, `IDENTITY_CACHE_MS`): once the
  account is **disabled** (`403`) or its **role changes** (`401`, and since its sessions were revoked the user signs in
  again), older tokens are refused within 60 s.
- An open WebSocket stays authenticated after its access token expires; reconnect with a fresh token.
- `AUTH_MODE=jwt` accepts only these tokens. `AUTH_MODE=dev` (refused in production) also accepts
  `dev:<uuid>:<ROLE>` for local development and tests.

`data` of sign-in, registration, refresh and password change:

```json
{
  "tokenType": "Bearer",
  "accessToken": "eyJhbGciOiJIUzI1NiIs…",
  "accessTokenExpiresAt": "2026-11-07T10:15:00.000Z",
  "refreshToken": "q8Xn…",
  "refreshTokenExpiresAt": "2026-12-07T10:00:00.000Z",
  "user": {
    "id": "6f1c…",
    "email": "ann@example.com",
    "displayName": "Ann",
    "role": "AGENT",
    "status": "ACTIVE",
    "lastLoginAt": "2026-11-07T10:00:00.000Z",
    "createdAt": "2026-11-01T08:00:00.000Z"
  }
}
```

These responses carry `Cache-Control: no-store`. The password hash and lockout counters are never returned.

## Endpoints

Staff use `/api/v1/admin/auth/*`, customers `/api/v1/customer/auth/*`. Each refuses accounts of the other kind with the
same `401` as a wrong password, and a refresh token only works at the prefix it was issued for.

| Method and path (after the prefix) | Auth         | Body                               | Notes                                                                                                                           |
| ---------------------------------- | ------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `POST /auth/register`              | none         | `{ email, password, displayName }` | **Customer prefix only.** Creates a `CUSTOMER` and signs in. `201`; `409` if the email is taken                                 |
| `POST /auth/login`                 | none         | `{ email, password }`              | `401` wrong email/password; `429 ACCOUNT_LOCKED`; `403` disabled                                                                |
| `POST /auth/refresh`               | none         | `{ refreshToken }`                 | New pair; `401` unknown, expired, reused or disabled                                                                            |
| `POST /auth/logout`                | none         | `{ refreshToken }`                 | Ends that sign-in. Always `204`                                                                                                 |
| `POST /auth/logout-all`            | access token |                                    | Ends every sign-in of the caller. `204`                                                                                         |
| `GET /auth/me`                     | access token |                                    | The caller's account                                                                                                            |
| `POST /auth/me/password`           | access token | `{ currentPassword, newPassword }` | `403` if the current one is wrong (counts toward the lock); `429`. Ends every other sign-in; returns a new pair for this device |

Rules for input:

- **Email** is trimmed and lower-cased (`Ann@Example.com` is the same account as `ann@example.com`); at most 254 characters.
- **Password**: 8 to 128 characters, no composition rules (NIST 800-63B). Compared after Unicode NFKC normalisation.
- Unknown body keys are `400`.

### Brute-force protection

- **Per account:** 5 wrong passwords in a row lock the account for 15 minutes (`429`, code `ACCOUNT_LOCKED`,
  `details.retryAfterSeconds`). A wrong current password on `POST /auth/me/password` counts too, so a stolen access
  token cannot be used to guess the password. A successful sign-in resets the count; an admin re-enabling the account or setting a
  password clears the lock.
- **Per client IP:** `login`, `refresh` and `register` allow `AUTH_RATE_LIMIT_PER_MINUTE` (20) requests per minute
  each (`429 RATE_LIMIT_EXCEEDED`, `Retry-After`). Counters live in Redis (`EVENT_BUS=redis`) or in memory. If Redis is
  down, requests are let through rather than locking everyone out. Behind a load balancer set `TRUST_PROXY` to the
  number of proxies so the real client IP is used.
- **Per user:** `POST /auth/me/password` allows the same number of requests per minute per signed-in user.
- An unknown email takes as long as a wrong password (a dummy hash is checked), so timing does not reveal accounts.
  Registration does reveal that an email is taken (`409`), as any sign-up form must.

## Account management (`/api/v1/admin/users`)

| Method and path                           | Who            | Body                                     | Notes                                                                 |
| ----------------------------------------- | -------------- | ---------------------------------------- | --------------------------------------------------------------------- |
| `GET /users?role=&status=&q=&page=&size=` | `users.read`   |                                          | Paged. `q` matches email or name, case-insensitive                    |
| `GET /users/:userId`                      | `users.read`   |                                          |                                                                       |
| `POST /users`                             | `users.manage` | `{ email, displayName, role, password }` | Staff roles only (`AGENT`, `SUPERVISOR`, `ADMIN`). `201`; `409` taken |
| `PATCH /users/:userId`                    | `users.manage` | any of `{ displayName, role, status }`   | See rules below                                                       |
| `POST /users/:userId/password`            | `users.manage` | `{ password }`                           | Sets a new password, clears a lock, ends every sign-in                |

`users.read` is granted to supervisors and admins, `users.manage` to admins, by default; admins can change that
(`docs/api-roles.md`).

- An admin cannot change their **own** role or status (so the last admin cannot lock themselves out by accident).
- `role` only moves between staff roles; a customer account cannot become staff (`400`).
- `status: "DISABLED"` ends every sign-in and is refused on every request within 60 s (also over the WebSocket at the
  next connect). `status: "ACTIVE"` re-enables and clears a sign-in lock.
- A new `role` ends every sign-in, and access tokens with the old role are refused within 60 s.

### The first admin

There is no sign-up for staff. Create the first admin from the command line (reads `DATABASE_URL`):

```sh
ADMIN_EMAIL=admin@example.com ADMIN_NAME="Ops Admin" ADMIN_PASSWORD='a long password' \
  pnpm --filter @chat-dashboard/backend user:create-admin
```

The password comes from the environment, not an argument, so it stays out of the process list. Further staff accounts
are created by an admin with `POST /users`.

## Names in the dashboard (`BACKEND1_MODE=local`)

With `BACKEND1_MODE=local` the agent and customer names shown in the inbox, the customer panel and `GET /agents/me`
come from `users.display_name` (and the customer's email). Loan data that only Backend 1 has (national id, salary,
occupation, blacklist) is `null`. `dev` keeps the synthetic profiles; production refuses `dev`.

## Data

`users` and `auth_sessions` (migration `20261111000000_auth_users`; see `docs/database-schema.md`). Access tokens are
checked against `users.role` and `users.status` (`AccountCheckedAuthClient`). Disabling also sets `chat_users.status`
(which covers `dev:` tokens); if that second write fails it is logged and the account stays disabled.

## Configuration

| Variable                     | Default | Meaning                                                                                                      |
| ---------------------------- | ------- | ------------------------------------------------------------------------------------------------------------ |
| `AUTH_MODE`                  | `dev`   | `jwt` in production. `dev` also accepts `dev:` tokens                                                        |
| `JWT_SECRET`                 | —       | At least 32 characters (`openssl rand -base64 48`). Required in production; elsewhere a random key per start |
| `ACCESS_TOKEN_TTL_SECONDS`   | `900`   | 60 to 86400                                                                                                  |
| `REFRESH_TOKEN_TTL_DAYS`     | `30`    | 1 to 365                                                                                                     |
| `AUTH_RATE_LIMIT_PER_MINUTE` | `20`    | Per IP and endpoint (per user for password change); `0` turns it off                                         |
| `TRUST_PROXY`                | `0`     | Proxies in front of the API (Express `trust proxy`)                                                          |

Rotating `JWT_SECRET` invalidates every access token at once; clients recover with their refresh token.

## Not built yet

- Email verification, "forgot password" by email, and multi-factor sign-in (no mail service exists here). Until then an
  admin resets a password with `POST /users/:userId/password`.
- Expired and revoked `auth_sessions` rows are not pruned yet; they are harmless but grow with every sign-in.
- The dashboard signs staff in with these endpoints (sign-in screen, refresh, sign-out; `docs/frontend-integration.md`).
  It has no screens yet for password change or account management.

## Tests

Unit: password hashing, tokens (tampering, `alg: none`, expiry, wrong key), the account check on access tokens
(disabled, role changed, cache), the rate limiter, and every rule of
`AuthService` and `UserService` (lockout, audience, rotation and reuse, password change, admin-only actions, self
changes). Integration (`auth-api.integration.test.ts`, needs `TEST_DATABASE_URL`): sign-in and protected routes over
HTTP, account creation, disabling, rotation and replay, lockout, customer registration and the staff/customer split,
and password change.
