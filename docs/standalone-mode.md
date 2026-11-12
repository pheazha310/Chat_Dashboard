# Standalone mode: Chat with and without LOS

The dashboard can be reached two ways, and both end in the **same chat account** and the same chat session:

|                      | LOS-integrated                                           | Standalone                                              |
| -------------------- | -------------------------------------------------------- | ------------------------------------------------------- |
| Where                | iframe inside LOS Web                                    | the dashboard's own URL                                 |
| Sign-in              | LOS staff hand-off token → `POST /api/v1/admin/auth/los` | username and password → `POST /api/v1/admin/auth/login` |
| Needs LOS to sign in | yes (LOS issues the token)                               | no (chat accounts are checked locally; LOS is optional) |
| After sign-in        | chat's own tokens                                        | chat's own tokens (identical)                           |

After sign-in **Chat never calls LOS to authenticate a request**. Conversations, messages, the WebSocket, attachments,
voice, read receipts, assignment, notes, tags, escalations and permissions all run on this backend's own database and
tokens. Only loan data (the customer's application in the agent panel) comes from LOS and is optional.

## 1. The two authentication providers

**Chat (native).** Staff accounts live in `users` with a scrypt password hash. `POST /auth/login` checks the password,
enforces the lockout (5 failures → 15 minutes), refuses disabled accounts and customer accounts, and issues an HS256
access token plus a rotating refresh token. Send `"provider": "chat"` to check the password against chat accounts
only and never send it to LOS.

**LOS.** `POST /auth/los` verifies an RS256 LOS hand-off token (issuer, audience, expiry, single use) and signs in the
chat account that identity is mapped to. `POST /auth/login` without `provider` (or `"auto"`) also tries the staff
member's LOS username and password first when `LOS_BASE_URL` is set, then falls back to the chat account.

Both return the same response and the same kind of session, so everything downstream is identical.

### When LOS is down

- `LOS_BASE_URL`/`LOS_ISSUER` unset: LOS is never contacted; `/auth/los` answers `503 LOS_SIGN_IN_DISABLED`.
- LOS unreachable at login: the LOS attempt fails, LOS is **not asked again for 30 seconds** (so later logins are not
  delayed by the 8 s timeout), and the chat password is checked. Send `provider: "chat"` to skip LOS entirely.
- LOS down after login: nothing changes. Access tokens are verified locally and refresh tokens are rotated locally.
- JWKS unreachable during an LOS hand-off: `503 LOS_SIGN_IN_UNAVAILABLE`; never a sign-in without verification.

> **Limit to know about.** A session started by an LOS hand-off lasts `LOS_STAFF_SESSION_SECONDS` (default 1 hour, fixed
> at sign-in) and renewing it needs a fresh hand-off from LOS. With LOS down, an account that has **no chat
> credentials** cannot sign in again after that. Give such accounts a username and password (see 3). The refresh
> then answers `401 SESSION_EXPIRED` (not the generic `UNAUTHORIZED`) so a client can say so and offer the chat sign-in.

## 2. One person, one chat account: identity mapping

`external_identities` maps an identity at an outside provider to the chat account it signs into:

| Column               | Meaning                                             |
| -------------------- | --------------------------------------------------- |
| `provider`           | `LOS` (the only provider so far)                    |
| `external_user_id`   | the provider's id (LOS `userId`)                    |
| `external_user_type` | `CUSTOMER` or `STAFF` (LOS numbers each separately) |
| `chat_user_id`       | `users.id`, the account it signs into               |
| `linked_by`          | the admin who linked it; null when LOS created it   |

Unique on (`provider`, `external_user_type`, `external_user_id`) and on (`chat_user_id`, `provider`): an LOS identity
maps to one account and an account has at most one LOS identity. `users.los_user_type`/`los_user_id` remain as a copy,
written in the same transaction, because DB checks and the "role is managed in LOS" rule read them. Existing LOS
accounts were backfilled by the migration.

**Matching is never done by email, phone or name.** An LOS sign-in whose identity is unmapped creates a new LOS-only
account (and its mapping); it never attaches to an existing chat account by guessing.

## 3. Account provisioning and linking (admins only)

An admin (`users.manage`) provisions and links; nobody can link themselves.

1. **Create a chat account** for a person: `POST /api/v1/admin/users` (username, password, role).
2. **Link it to their LOS identity** so their LOS sign-in lands in this account instead of creating a second one:
   `POST /api/v1/admin/users/:userId/identities` `{ "provider": "LOS", "externalUserType": "STAFF", "externalUserId": 42 }`
   (201). 409 if the LOS identity belongs to another account or the account already has one; 400 if the type does not
   match the account (a staff account takes `STAFF`). From then on LOS sets the account's role at every LOS sign-in.
3. **Or, for someone who already signs in through LOS and has no chat password**, give the _same_ account chat
   credentials: `POST /api/v1/admin/users/:userId/password` `{ "username": "lee", "password": "..." }`. This signs
   them out everywhere; no second account is created.
4. **Unlink**: `DELETE /api/v1/admin/users/:userId/identities/LOS` removes the mapping and signs the account out
   everywhere. Refused (409) when LOS is the account's only sign-in.

## 4. Customers

Standalone sign-in on the dashboard is **staff only**: `/api/v1/admin/auth/login` refuses customer accounts with the
same message as a wrong password. Customer standalone login stays off until an approved customer authentication and
account-recovery process exists (there is no password recovery today; see `docs/api-auth.md`, "Not built yet").
Customers keep using LOS or the mobile app, whose own registration and sign-in are unchanged.

## 5. Sessions, expiry and revocation

| Event                                 | Effect                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Access token                          | 15 min for staff (`STAFF_ACCESS_TOKEN_TTL_SECONDS`), verified locally, HS256 only                 |
| Chat sign-in                          | lasts `REFRESH_TOKEN_TTL_DAYS` (30), fixed at sign-in; refresh rotates the token                  |
| LOS hand-off sign-in                  | lasts `LOS_STAFF_SESSION_SECONDS` (1 h), fixed at sign-in                                         |
| Account disabled                      | all sessions revoked at once; refresh refused; existing access tokens refused within 60 s (`403`) |
| Role changed (admin, or LOS)          | all sessions revoked; old access tokens refused within 60 s (`401`)                               |
| Admin unlinks LOS or sets a password  | all that account's sessions are revoked (linking does not revoke)                                 |
| Logout / logout-all / password change | that sign-in / all / all other devices end                                                        |
| Refresh token reused                  | the whole sign-in is revoked and the event is audited                                             |
| Token cannot be verified              | `401`. Nothing is granted when verification is impossible                                         |

Disabling or revoking is never bypassed by either provider: both go through the same account checks, and an LOS
sign-in of a disabled account is refused (`403`).

## 6. Audit trail

`auth_audit_events` records, append-only: `LOGIN_SUCCESS`, `LOGIN_FAILED` (with `reason`: `BAD_PASSWORD`,
`UNKNOWN_USER`, `DISABLED`, `LOCKED`, `WRONG_AUDIENCE`, `LOS_UNAVAILABLE`, `LOS_REFUSED`), `LOGOUT`, `LOGOUT_ALL`,
`REFRESH_REUSE_DETECTED`, `SESSIONS_REVOKED`, `IDENTITY_LINKED`, `IDENTITY_UNLINKED`, each with provider (`CHAT`/`LOS`),
user, acting admin, IP and user agent. It never stores passwords, tokens or token hashes, and the attempted username
only when the text looks like a username (so a password typed in the wrong box is dropped). Writes are best effort: a
failed audit write is logged and never blocks or allows a sign-in. There is no read API yet; query the table.

## 7. Frontend

The login page and the profile menu show **Standalone access** or **LOS-integrated access** (iframe plus a configured
`VITE_LOS_WEB_ORIGIN`). The sign-in form is unchanged (LOS credentials are still tried first, then the chat account).
Embedded users are signed in by the hand-off with no form.

## 8. Tests

Unit (`auth.standalone.test.ts`, `user.identity-link.test.ts`, `auth.standalone-session.test.ts`,
`auth.los-login.test.ts`): LOS up/down at login, session survives LOS being down, no duplicate users, disabled and
locked accounts, customers refused, linking rules, audit events, permissions without LOS. Integration
(`auth-standalone.integration.test.ts`, needs `TEST_DATABASE_URL`): the same over HTTP and PostgreSQL with LOS
unreachable, the migration's constraints, and chat credentials for an LOS-only account.

## 9. Not covered

- Self-service linking (a signed-in user proving LOS ownership) is not built; linking is admin-only.
- No read API or screen for the audit trail, and no admin UI for linking (API and Postman only).
- Whether an already-open WebSocket is closed when its account is disabled was not changed or re-verified by this work; see `docs/websocket-events.md`.
