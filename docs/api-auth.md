# Authentication and accounts API

This backend owns sign-in for everyone: dashboard staff (`AGENT`, `SUPERVISOR`, `ADMIN`) and mobile customers
(`CUSTOMER`). It stores accounts and scrypt password hashes, issues access and refresh tokens, and manages accounts.
People sign in with username and password, or with a token from LOS (the loan system, see [Sign in with LOS](#sign-in-with-los)).
Interactive reference for the staff routes: `GET /api/v1/admin/openapi.json` (tags _Auth_ and _Users_). Envelope:
`{ "status": "success", "data": ... }`; errors `{ "status": "error", "error": { code, message, details? } }`.

## Tokens

| Token   | What it is                                                         | Lifetime                                                                                                          | Stored on the server                  |
| ------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Access  | HS256 JWT: `sub` = user id, `role`, `iss`/`aud` = `chat-dashboard` | Staff `STAFF_ACCESS_TOKEN_TTL_SECONDS` (900 = 15 min), customers `CUSTOMER_ACCESS_TOKEN_TTL_SECONDS` (3600 = 1 h) | No (signed with `JWT_SECRET`)         |
| Refresh | 256 random bits, base64url, opaque                                 | `REFRESH_TOKEN_TTL_DAYS` (30) from sign-in; refreshing does not extend it                                         | Only its SHA-256, in `refresh_tokens` |

- Send the access token as `Authorization: Bearer <accessToken>` on REST, and in the first `auth` frame on `/ws`
  (`docs/websocket-events.md`). The user id in the token is `users.id`; it is the id every other table stores.
- **Refresh rotates.** `POST …/auth/refresh` revokes the presented refresh token and returns a new pair in the same
  sign-in (`family_id`); the old session's `replaced_by_id` points at the new one, so a sign-in is a chain. Presenting
  a refresh token that was already used (a stolen copy, or two tabs refreshing at once) revokes the whole sign-in: the
  user signs in again. **Clients must refresh one request at a time** and keep only the
  newest refresh token.
- **A sign-in has a fixed end.** Every refresh token of one sign-in expires at the same time
  (`refreshTokenExpiresAt` stays the same across refreshes), `REFRESH_TOKEN_TTL_DAYS` after the sign-in. After that the
  user signs in again, so a stolen refresh token cannot be kept alive by refreshing it.
- Expired `refresh_tokens` rows are deleted: the user's own at each new sign-in, and everyone's by a background job every
  `AUTH_SESSION_CLEANUP_INTERVAL_MINUTES` (60). Revoked rows that have not expired yet stay; they detect a reused token.
- An access token stays valid until it expires even after sign-out or a password change. It is, however, checked
  against its account on every request (the account is re-read at most once a minute, `IDENTITY_CACHE_MS`): once the
  account is **disabled** (`403`) or its **role changes** (`401`, and since its sessions were revoked the user signs in
  again), older tokens are refused within 60 s.
- An open WebSocket stays authenticated after its access token expires; reconnect with a fresh token.
- `AUTH_MODE=jwt` accepts only these tokens. `AUTH_MODE=dev` (refused in production) also accepts
  `dev:<uuid>:<ROLE>` for local development and tests.

### Development sign-in (`AUTH_MODE=dev` only)

Sign in the LOS way without LOS: send the identity an LOS token would carry, and get this backend's tokens. No token,
no key, no password.

```http
POST /api/v1/dev/login
{ "type": "staff", "userId": 7, "username": "Sophea", "role": "agent" }

POST /api/v1/dev/login
{ "type": "customer", "userId": 2, "username": "Dara" }
```

- `type`: `staff` or `customer` (LOS numbers each kind separately, so staff 2 and customer 2 are two accounts).
  `userId`: the LOS userId, a positive 32-bit integer (default `1`). `username`: the name shown in chat (default
  `Dev Staff` / `Dev Customer`). Staff `role`: `agent`, `supervisor` or `admin`, any case (default `agent`); LOS role
  names from `LOS_STAFF_ROLE_MAP` are not used here.
- It runs the same account logic as `POST /auth/los`: the account is found by (`type`, `userId`) or created as an
  LOS-only account (no username or password, `losUserId` set, with its `staff` or `customers` row); the role and name
  follow what you send, and a changed role signs that account out of its other devices. So a dev account is the very
  account a real LOS token for that user reaches later.
- The answer is the same as `POST /auth/login`; staff tokens work on `/api/v1/admin`, customer tokens on
  `/api/v1/customer`. `400` bad body; `403` if an admin disabled the account.
- The route exists only with `AUTH_MODE=dev`; otherwise (and always in production, where env.ts refuses
  `AUTH_MODE=dev`) it is `404`. It is not in the OpenAPI document. Postman: _02 Staff sign-in_ → _Dev sign-in, the LOS
  way_. To test the real token exchange instead, use `pnpm los:token` (below).

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
    "username": "ann",
    "email": "ann@example.com",
    "losUserId": null,
    "displayName": "Ann",
    "role": "AGENT",
    "status": "ACTIVE",
    "lastLoginAt": "2026-11-07T10:00:00.000Z",
    "createdAt": "2026-11-01T08:00:00.000Z"
  }
}
```

These responses carry `Cache-Control: no-store`. The password hash and lockout counters are never returned. `email` is
`null` for an account that only signs in with LOS; `losUserId` is the LOS userId of an LOS-linked account.

## Endpoints

Staff use `/api/v1/admin/auth/*`, customers `/api/v1/customer/auth/*`. Each refuses accounts of the other kind with the
same `401` as a wrong password, and a refresh token only works at the prefix it was issued for.

| Method and path (after the prefix) | Auth         | Body                                              | Notes                                                                                                                                                                                        |
| ---------------------------------- | ------------ | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /auth/register`              | none         | `{ username, password, displayName, email? }`     | **Customer prefix only.** Creates a `CUSTOMER` and signs in. `201`; `409` if the username is taken                                                                                           |
| `POST /auth/login`                 | none         | `{ username, password }`                          | `401` wrong username/password; `429 ACCOUNT_LOCKED`; `403` disabled                                                                                                                          |
| `POST /auth/los`                   | none         | customer `{ losToken }`, staff `{ handoffToken }` | Sign in with LOS (below). `401` any token problem; `403` disabled; `503 LOS_SIGN_IN_DISABLED` if LOS is not configured, `503 LOS_SIGN_IN_UNAVAILABLE` if a hand-off token cannot be recorded |
| `POST /auth/refresh`               | none         | `{ refreshToken }`                                | New pair; `401` unknown, reused or disabled; `401 SESSION_EXPIRED` when the sign-in has ended                                                                                                |
| `POST /auth/logout`                | none         | `{ refreshToken }`                                | Ends that sign-in. Always `204`                                                                                                                                                              |
| `POST /auth/logout-all`            | access token |                                                   | Ends every sign-in of the caller. `204`                                                                                                                                                      |
| `GET /auth/me`                     | access token |                                                   | The caller's account                                                                                                                                                                         |
| `POST /auth/me/password`           | access token | `{ currentPassword, newPassword }`                | `403` if the current one is wrong (counts toward the lock); `429`; `409` for an LOS-only account. Ends every other sign-in; returns a new pair for this device                               |

Rules for input:

- **Username** is trimmed and lower-cased (`Ann` is the same account as `ann`); 3 to 32 characters of `a-z`, `0-9`, `.`, `_`, `-`, starting with a letter or digit.
- **Email** is an optional contact address, trimmed and lower-cased, at most 254 characters, unique; it is not used to sign in.
- **Password**: 8 to 128 characters, no composition rules (NIST 800-63B). Compared after Unicode NFKC normalisation.
- Unknown body keys are `400`.

### Staff sign-in with LOS username and password

When LOS sign-in is configured (`LOS_ISSUER`, a key, and `LOS_BASE_URL`), `POST /api/v1/admin/auth/login` first tries the
credentials against LOS: this backend calls LOS `POST /admin/auth/login` with the username and password and gets the LOS
staff **access token** (`aud` = `LOS_STAFF_ACCESS_AUDIENCE`, default `los-client`; `type: "staff"`, `tokenType: "access"`).
It verifies that token like any LOS token (RS256 signature, `iss`, role via `LOS_STAFF_ROLE_MAP`) and signs the staff
member into their LOS-only account, as `POST /auth/los` does. The token never leaves the server, so, unlike the hand-off
token, it needs no `jti` or one-use rule. The password and token are used for that one LOS request only, never stored or
logged. If LOS refuses the credentials or cannot be reached, the same request falls back to a chat account's own
username and password. A wrong LOS role (not agent/supervisor or mapped) is `401`. Customers
(`/api/v1/customer/auth/login`) never go to LOS.

For a whole team: every LOS staff role must be in `LOS_STAFF_ROLE_MAP` (or be `agent`/`supervisor`), or that person gets
`401`; the first sign-in of each person creates their account, later ones reuse it. All LOS logins come from this server's
IP, and LOS limits staff logins (the Postman pack says 20 per 15 minutes, per what is not documented), so a burst of
sign-ins can hit that limit: the answer is then `429 LOS_RATE_LIMITED` ("try again in a minute"), not a wrong-password
message. Ask LOS whether the limit is per IP and, if so, to allowlist this server or raise it. Empty `LOS_STAFF_ACCESS_AUDIENCE` turns this off.

### Sign in with LOS

LOS (Backend 1, the loan system) already signs its users in. Instead of a second password, the client sends a token
LOS issued, once; this backend checks it, finds or creates the account and answers with its own token pair. From then
on the client only uses this backend's tokens (refresh as usual); the LOS token is never stored.

| Who             | Endpoint                         | Body               | LOS token                                                                                                                                                |
| --------------- | -------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mobile customer | `POST /api/v1/customer/auth/los` | `{ losToken }`     | The LOS access token the app holds: `aud` = `LOS_CUSTOMER_AUDIENCE`, `type: "customer"`, `tokenType: "access"`                                           |
| Dashboard staff | `POST /api/v1/admin/auth/los`    | `{ handoffToken }` | A short-lived hand-off token LOS issues for chat: `aud` = `LOS_HANDOFF_AUDIENCE`, `type: "staff"`, `tokenType` = `LOS_HANDOFF_TOKEN_TYPE`, `role`, `jti` |

- **Checked:** RS256 signature with the LOS key (`LOS_JWKS_URL`, or one PEM in `LOS_PUBLIC_KEY`), `iss` =
  `LOS_ISSUER`, the audience above, expiry, and the claims: `userId` a positive 32-bit integer, `username` a non-empty
  string, and an `exp` (a token without one is refused). For staff, `role` must be `agent` or `supervisor` (any case) or an
  LOS role name mapped in `LOS_STAFF_ROLE_MAP` (e.g. `loan_officer:AGENT,branch_manager:SUPERVISOR,chat_admin:ADMIN`);
  other roles are refused. **ADMIN is granted only through the map**: an LOS role called `admin` is refused unless mapped,
  because it may mean something else in LOS. Any failure is the same
  `401 Invalid LOS token` (the reason is logged at debug level). A customer token is refused at the staff endpoint and the
  other way round.
- **Hand-off tokens sign in once.** The staff hand-off token must carry a `jti` (a unique id, at most 200 characters; this
  is a requirement on LOS, to be confirmed with the LOS team). Its `jti` is recorded in PostgreSQL (`los_handoff_tokens`, primary key `jti`, so the claim is atomic across instances and survives
  restarts; expired rows are deleted on the way), and the same `jti` again is `401`, so a leaked hand-off token cannot be replayed. If
  the store cannot be reached the sign-in is refused (`503 LOS_SIGN_IN_UNAVAILABLE`) rather than allowed. A hand-off token
  whose life (`exp` - `iat`) is longer than `LOS_HANDOFF_TOKEN_MAX_AGE` is refused too. The customer's
  LOS access token is not single-use: the app keeps it and may exchange it again.
- **Accounts:** found by (`los_user_type`, `los_user_id`); LOS numbers customers and staff separately, so customer 2 and
  staff member 2 are two accounts. The first sign-in creates an account **without username or password** (`username: null`);
  it cannot use `/auth/login`, change a password (`409`) or be given one by an admin (`409`). `display_name` follows the
  LOS `username` on every sign-in. For staff the **role follows LOS** on every sign-in; a changed role ends the account's
  other sign-ins, as an admin role change does. Admins cannot change an LOS account's role (`409`); change it in LOS. A `DISABLED` account is refused (`403`) even with a valid LOS token.
- The LOS userId is also copied to `chat_users.los_user_id`.
- **Refreshing does not ask LOS.** Someone removed, disabled or demoted in LOS keeps chat access, with the role of their
  last LOS sign-in, until that sign-in ends (`REFRESH_TOKEN_TTL_DAYS`, 30 by default). To cut access at once, an admin
  sets the account to `DISABLED` (`PATCH /users/:userId`); for LOS staff, consider a shorter `REFRESH_TOKEN_TTL_DAYS`.
- LOS tokens are accepted up to 30 seconds past `exp` (clock difference between LOS and this server). If the LOS keys
  cannot be loaded (`LOS_JWKS_URL` unreachable), every LOS sign-in answers `401` and a warning is logged.
- An existing email/password account is not merged with an LOS account (the LOS token carries no username).
- Not configured (`LOS_ISSUER` unset): both endpoints answer `503 LOS_SIGN_IN_DISABLED`.

**The real LOS (from the LOS integration pack, 2026-11-11).** `LOS_ISSUER=los-backend`; `LOS_JWKS_URL` is
`https://api-dev.los.delightech.asia/api/v1/guest/.well-known/jwks.json` (Dev) or
`https://api-uat.los.delightech.asia/api/v1/guest/.well-known/jwks.json` (Staging); each environment has its own key.
Customer access tokens (`aud` `luyleun`, `type` `customer`, `tokenType` `access`, 1 hour) match what this backend checks.
Staff hand-off is **not working yet**: LOS issues `aud` `analytics-dashboard`, `tokenType` `dashboard-handoff` and no
`jti`, while this backend needs `chat`, `LOS_HANDOFF_TOKEN_TYPE` and a `jti`. Agree these with LOS before staff sign in.
LOS role names are upper case (e.g. `CREDIT_SUPPORT_OFFICER`); the map is case-insensitive. LOS timestamps such as
`expiresAt` are Cambodia local time labelled `Z`; the JWT `exp` is real UTC, so use `exp`. LOS sends no event when staff
are disabled or change role, so keep the staff sign-in short (see "Refreshing does not ask LOS").

**Waiting on LOS (open items from the integration pack).**

- Staff hand-off token: `aud` `chat`, `tokenType` `chat-handoff` and a `jti` (pack items 1 and 2). Until then staff LOS sign-in is refused, by design.
- Until then, loan data reaches the agent panel another way: at a customer's LOS sign-in the customer's own token reads their latest
  application once and six fields are kept (`loan_application_snapshots`; the token is not). It is as fresh as their last sign-in.
  It needs `LOS_BASE_URL`. This is a stopgap, not the service integration below.
- Until then, loan data reaches the agent panel another way: at a customer's LOS sign-in the customer's own token reads their latest
  application once and six fields are kept (`loan_application_snapshots`; the token is not). It is as fresh as their last sign-in.
  It needs `LOS_BASE_URL`. This is a stopgap, not the service integration below.
- Machine-to-machine access (`/integration/chat/*`, API key + IP allowlist, pack item 3). `backend/src/modules/los-data/`
  holds a `LosDataClient` (timeouts, error mapping, no tokens or customer data logged) behind a `LosServiceAuth`
  strategy. The only strategy is `NoLosServiceAuth`, which refuses with `503 LOS_DATA_UNAVAILABLE`, and the client is not
  wired into the container: LOS has not defined the path or the credentials, and nothing here is guessed.
- The LOS role to chat role map (`LOS_STAFF_ROLE_MAP`) needs business approval (item 5); the Dev LOS Web origin (item 6),
  the chat origins and outbound IPs (item 7) and test accounts (item 8) are still to be supplied.
- LOS timestamps (`appliedDate`, `expiresAt`, ...) are Cambodia local time labelled `Z`. They are passed on unchanged and
  not converted until the business confirms how; JWT `exp` and `iat` are real UTC and are used normally.

**Mock LOS: the real flow before LOS is connected** (development and staging; refuses `NODE_ENV=production`).
`pnpm los:mock` runs a stand-in LOS on `http://localhost:4500` with its own staff and customers and passwords. It signs
tokens like LOS and publishes its key as a JWKS, so the backend runs unchanged, even with `AUTH_MODE=jwt`. Connecting the
real LOS later means changing only `.env`.

1. Run `pnpm los:mock`. It prints three lines for `backend/.env` (`LOS_ISSUER=http://localhost:4500`,
   `LOS_JWKS_URL=http://localhost:4500/.well-known/jwks.json` and the matching `LOS_STAFF_ROLE_MAP`), plus its users.
   Add the lines and restart the backend.
2. **Staff:** `POST http://localhost:4500/staff/login { "username": "agent4", "password": "password123" }` returns
   `{ handoffToken }`. Exchange it with `POST /api/v1/admin/auth/los { handoffToken }`; it works once and expires after
   2 minutes.
3. **Customers:** `POST http://localhost:4500/customer/login { "username": "dara", "password": "password123" }` returns
   `{ losToken }`. Exchange it with `POST /api/v1/customer/auth/los { losToken }`; it can be reused for 1 hour.

| Mock user     | Kind     | LOS id | LOS role         | Chat role                               |
| ------------- | -------- | ------ | ---------------- | --------------------------------------- |
| `admin`       | staff    | 1      | `chat_admin`     | ADMIN                                   |
| `agent4`      | staff    | 4      | `loan_officer`   | AGENT                                   |
| `agent5`      | staff    | 5      | `loan_officer`   | AGENT                                   |
| `supervisor9` | staff    | 9      | `branch_manager` | SUPERVISOR                              |
| `dara`        | customer | 101    | -                | CUSTOMER (`vanna` 102, `bopha` 103 too) |

All mock users have the password `password123`; `GET http://localhost:4500/users` lists them. The mock shares its key
with `pnpm los:token`. In Postman, the **Mock LOS** requests in _02_ and _10_ fill `losHandoffToken` and
`losCustomerToken` for the LOS sign-in requests that follow them (`losUrl` variable). When LOS is ready, set
`LOS_ISSUER` and `LOS_JWKS_URL` (or `LOS_PUBLIC_KEY`) and the real role names in `LOS_STAFF_ROLE_MAP`, and stop the mock.

**One token at a time without a server.** `pnpm los:token` also stands in for LOS: it
keeps a key pair in `backend/.los-dev/` (git-ignored) and signs tokens of the shape above.

1. `pnpm los:token setup` prints `LOS_ISSUER` and `LOS_PUBLIC_KEY` lines; add them to `backend/.env` and restart the
   backend.
2. `pnpm los:token customer [userId] [username]` prints a customer token (1 hour, reusable) and a `curl` for
   `POST /api/v1/customer/auth/los`.
3. `pnpm los:token staff [userId] [username] [role]` prints a hand-off token (10 minutes, **works once**) and a `curl`
   for `POST /api/v1/admin/auth/los`. `role` defaults to `agent`; `admin` needs a `LOS_STAFF_ROLE_MAP` entry.

In Postman, paste the token into the `losCustomerToken` or `losHandoffToken` collection variable. Remove the two lines
from `.env` before pointing the backend at the real LOS.

### Brute-force protection

- **Per account:** 5 wrong passwords in a row lock the account for 15 minutes (`429`, code `ACCOUNT_LOCKED`,
  `details.retryAfterSeconds`). A wrong current password on `POST /auth/me/password` counts too, so a stolen access
  token cannot be used to guess the password. A successful sign-in resets the count; an admin re-enabling the account or setting a
  password clears the lock.
- **Per client IP:** `login`, `los`, `refresh`, `logout` and `register` allow `AUTH_RATE_LIMIT_PER_MINUTE` (20) requests per minute
  each (`429 RATE_LIMIT_EXCEEDED`, `Retry-After`). Counters live in Redis (`EVENT_BUS=redis`) or in memory. If Redis is
  down, requests are let through rather than locking everyone out. Behind a load balancer set `TRUST_PROXY` to the
  number of proxies so the real client IP is used.
- **Per user:** `POST /auth/me/password` allows the same number of requests per minute per signed-in user.
- An unknown username takes as long as a wrong password (a dummy hash is checked), so timing does not reveal accounts.
  Registration does reveal that a username is taken (`409`), as any sign-up form must.

## Account management (`/api/v1/admin/users`)

| Method and path                                      | Who            | Body                                                        | Notes                                                                                                                           |
| ---------------------------------------------------- | -------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `GET /users?role=&status=&q=&chatLogin=&page=&size=` | `users.read`   |                                                             | Paged. `q` matches username, email or name, case-insensitive. `chatLogin=false`: only accounts with no chat password (LOS-only) |
| `GET /users/:userId`                                 | `users.read`   |                                                             |                                                                                                                                 |
| `POST /users`                                        | `users.manage` | `{ username, displayName, role, password, email?, staff? }` | Staff roles only (`AGENT`, `SUPERVISOR`, `ADMIN`). `201`; `409` email or employee code taken                                    |
| `PATCH /users/:userId`                               | `users.manage` | any of `{ displayName, role, status, staff, customer }`     | See rules below                                                                                                                 |
| `POST /users/:userId/password`                       | `users.manage` | `{ password }`                                              | Sets a new password, clears a lock, ends every sign-in; `409` for an LOS-only account                                           |

`users.read` is granted to supervisors and admins, `users.manage` to admins, by default; admins can change that
(`docs/api-roles.md`).

- **Profiles.** Every account has one profile row, created with it: `staff` for staff accounts, `customers` for
  customers (migration `20261117000000_staff_and_customers`, which also created them for existing accounts). The API
  returns them as `user.staff` and `user.customer` (the other one is `null`) everywhere a user is returned, including
  sign-in and `/me`. Send only the fields that change; `null` clears one.
  - `staff`: `employeeCode` (unique, up to 100), `department` (up to 100), `maxConcurrentChats` (1-1000; stored only,
    assignment does not enforce it yet).
  - `customer`: `phone` (E.164, e.g. `+85512345678`), `customerCode` (the LOS customer code, unique, up to 100),
    `preferredLanguage` (a language tag such as `km` or `en`). The customer's phone is also shown in the customer panel.
  - `staff` on a customer account, or `customer` on a staff account, is `400`; a taken employee or customer code is
    `409`. Customers cannot edit their own profile yet (no customer endpoint).
- An admin cannot change their **own** role or status (so the last admin cannot lock themselves out by accident).
- `role` only moves between staff roles; a customer account cannot become staff (`400`).
- `status: "DISABLED"` ends every sign-in and is refused on every request within 60 s (also over the WebSocket at the
  next connect). `status: "ACTIVE"` re-enables and clears a sign-in lock.
- A new `role` ends every sign-in, and access tokens with the old role are refused within 60 s.

### The first admin

There is no sign-up for staff. Create the first admin from the command line (reads `DATABASE_URL`):

```sh
ADMIN_USERNAME=admin ADMIN_NAME="Ops Admin" ADMIN_PASSWORD='a long password' \
  pnpm --filter @chat-dashboard/backend user:create-admin
```

The password comes from the environment, not an argument, so it stays out of the process list. Further staff accounts
are created by an admin with `POST /users`.

### Test accounts (local development)

To try the chat locally, create one account per role (refused with `NODE_ENV=production`; re-running skips accounts
that already exist):

```sh
pnpm --filter @chat-dashboard/backend user:seed-test   # password: password123, or set SEED_PASSWORD
```

| Username     | Role       |
| ------------ | ---------- |
| `admin`      | ADMIN      |
| `supervisor` | SUPERVISOR |
| `agent1`     | AGENT      |
| `agent2`     | AGENT      |
| `customer1`  | CUSTOMER   |
| `customer2`  | CUSTOMER   |

Staff sign in with `POST /api/v1/admin/auth/login`, customers with `POST /api/v1/customer/auth/login`.

## Names in the dashboard (`BACKEND1_MODE=local`)

With `BACKEND1_MODE=local` the agent and customer names shown in the inbox, the customer panel and `GET /agents/me`
come from `users.display_name` (and the customer's email). Loan data that only Backend 1 has (national id, salary,
occupation, blacklist) is `null`. `dev` keeps the synthetic profiles; production refuses `dev`.

## Data

`users` and `refresh_tokens` (migrations `20261111000000_auth_users` and `20261114000000_los_sign_in`; see
`docs/database-schema.md`). Access tokens are
checked against `users.role` and `users.status` (`AccountCheckedAuthClient`). Disabling also sets `chat_users.status`
(which covers `dev:` tokens); if that second write fails it is logged and the account stays disabled.

## Configuration

| Variable                                         | Default        | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------ | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_MODE`                                      | `jwt`          | `dev` (local only, refused in production) also accepts `dev:` tokens                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `JWT_SECRET`                                     | —              | At least 32 characters (`openssl rand -base64 48`). Required in production; elsewhere a random key per start                                                                                                                                                                                                                                                                                                                                                                           |
| `STAFF_ACCESS_TOKEN_TTL_SECONDS`                 | `900`          | Access-token lifetime for agents, supervisors and admins; 60 to 86400                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `CUSTOMER_ACCESS_TOKEN_TTL_SECONDS`              | `3600`         | Access-token lifetime for customers (mobile); 60 to 86400                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `REFRESH_TOKEN_TTL_DAYS`                         | `30`           | How long one sign-in lasts (fixed at sign-in); 1 to 365                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `LOS_ISSUER`                                     | —              | `iss` of LOS tokens. Unset = sign in with LOS is off (`503`)                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `LOS_JWKS_URL`                                   | —              | LOS public keys (JWKS); keys may rotate. Either this or `LOS_PUBLIC_KEY` when `LOS_ISSUER` is set                                                                                                                                                                                                                                                                                                                                                                                      |
| `LOS_PUBLIC_KEY`                                 | —              | One LOS RS256 public key (PEM, `\n` allowed for newlines)                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `LOS_CUSTOMER_AUDIENCE`                          | `luyleun`      | `aud` of the LOS customer access token                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `LOS_HANDOFF_AUDIENCE`                           | `chat`         | `aud` of the LOS staff hand-off token                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `LOS_STAFF_ACCESS_AUDIENCE`                      | `los-client`   | `aud` of the LOS staff access token received at LOS username/password sign-in; empty turns it off                                                                                                                                                                                                                                                                                                                                                                                      |
| `LOS_HANDOFF_TOKEN_TYPE`                         | `chat-handoff` | `tokenType` claim of the hand-off token                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `LOS_BASE_URL`                                   | unset          | The LOS API (also turns on reading a customer's application at their LOS sign-in: api-conversations.md, "Loan application behind a conversation") (also turns on reading a customer's application at their LOS sign-in: api-conversations.md, "Loan application behind a conversation") (Dev `https://api-dev.los.delightech.asia/api/v1`, Staging `https://api-uat.los.delightech.asia/api/v1`). Its host must equal the `LOS_JWKS_URL` host: each environment signs with its own key |
| `LOS_STAFF_SESSION_SECONDS`                      | `3600`         | How long a staff session started by an LOS hand-off lasts (300-86400), fixed at sign-in; then the dashboard needs a fresh hand-off, which LOS refuses for suspended staff and which carries a changed role. Passwords and customers are unaffected                                                                                                                                                                                                                                     |
| `LOS_HANDOFF_TOKEN_MAX_AGE`                      | `120`          | Longest life in seconds (`exp` - `iat`, 10-600) accepted for a hand-off token                                                                                                                                                                                                                                                                                                                                                                                                          |
| `LOS_WEB_ORIGIN`, `CHAT_WEB_ORIGIN`              | unset          | Exact origins of LOS Web and the dashboard (no path, no `*`); for the iframe `postMessage` checks. LOS Web Dev origin is still pending                                                                                                                                                                                                                                                                                                                                                 |
| `LOS_SERVICE_API_KEY`, `LOS_SERVICE_ALLOWED_IPS` | unset          | **Pending at LOS** (machine-to-machine `/integration/chat/*` is not built); nothing reads them yet                                                                                                                                                                                                                                                                                                                                                                                     |
| `AUTH_RATE_LIMIT_PER_MINUTE`                     | `20`           | Per IP and endpoint (per user for password change); `0` turns it off                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `AUTH_SESSION_CLEANUP_INTERVAL_MINUTES`          | `60`           | How often expired sessions of every user are deleted; `0` turns the job off                                                                                                                                                                                                                                                                                                                                                                                                            |
| `LOS_STAFF_ROLE_MAP`                             | —              | LOS staff role names that differ from the chat's, as `losName:ROLE` pairs; the only way to grant ADMIN. A bad pair stops start-up                                                                                                                                                                                                                                                                                                                                                      |
| `TRUST_PROXY`                                    | `0`            | Proxies in front of the API (Express `trust proxy`)                                                                                                                                                                                                                                                                                                                                                                                                                                    |

Rotating `JWT_SECRET` invalidates every access token at once; clients recover with their refresh token.

## Not built yet

- Email verification, "forgot password" by email, and multi-factor sign-in (no mail service exists here). Until then an
  admin resets a password with `POST /users/:userId/password`.
- The dashboard has no LOS hand-off screen yet: it still signs staff in with username and password.
- The dashboard signs staff in with these endpoints (sign-in screen, refresh, sign-out; `docs/frontend-integration.md`).
  It has no screens yet for password change or account management.

## Tests

Unit: password hashing, tokens (tampering, `alg: none`, expiry, wrong key), the account check on access tokens
(disabled, role changed, cache), the rate limiter, and every rule of
`AuthService` and `UserService` (lockout, audience, rotation and reuse, password change, admin-only actions, self
changes). Integration (`auth-api.integration.test.ts`, needs `TEST_DATABASE_URL`): sign-in and protected routes over
HTTP, account creation, disabling, rotation and replay, lockout, customer registration and the staff/customer split,
and password change.

## Session URLs of the "Chat Backend" Postman collection

[postman/chat-backend.postman_collection.json](postman/chat-backend.postman_collection.json) (with
`chat-backend.postman_environment.template.json`) uses two base URLs: `{{baseUrl}}/api/v1/customer` and
`{{baseUrl}}/api/v1/agents` (the staff API, the same router as `/api/v1/admin`, without a `/chat` segment).

| Request                                                      | Same as                          | Success |
| ------------------------------------------------------------ | -------------------------------- | ------- |
| `POST /api/v1/customer/auth/session` `{ losToken }`          | `POST /api/v1/customer/auth/los` | 201     |
| `POST /api/v1/agents/auth/session` `{ handoffToken }`        | `POST /api/v1/admin/auth/los`    | 201     |
| `GET /api/v1/customer/auth/me`, `GET /api/v1/agents/auth/me` | `/auth/me`                       | 200     |

The customer's id-less chat requests (`GET conversation`, `GET`/`POST conversation/messages`, `POST attachments`) are in
[api-customer-mobile.md](api-customer-mobile.md). The same APIs also answer under `/customer/api/v1[/chat]` and
`/agent/api/v1[/chat]`.

## Standalone mode (LOS optional)

Flows, provisioning, linking, revocation and the audit trail are in [standalone-mode.md](standalone-mode.md). API additions:

- `POST /auth/login` accepts an optional `provider`: `"auto"` (default: LOS first for staff when `LOS_BASE_URL` is set,
  then chat accounts) or `"chat"` (chat accounts only; the password is never sent to LOS). After LOS could not be
  reached, LOS is skipped for 30 seconds.
- `POST /users/:userId/identities` `{ provider: "LOS", externalUserType, externalUserId }` (201, admin) links an
  existing account to an LOS identity; `DELETE /users/:userId/identities/LOS` (admin) unlinks it and signs the account
  out everywhere. 409 for an identity already linked elsewhere, a second identity, or unlinking an account whose only
  sign-in is LOS; 400 when the identity type does not match the account.
- `POST /users/:userId/password` also accepts `username` for an LOS-only account, giving the same account chat
  credentials (409 without it, 400 for an account that already has a username).
- Every sign-in, refusal, logout, revocation and link is written to `auth_audit_events` (never secrets).
