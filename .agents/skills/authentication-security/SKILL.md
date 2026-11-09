---
name: authentication-security
description: Implement or review authentication, session handling, authorization, input validation and secret handling. Use for login/session work, permission checks, and any security-sensitive change.
---

# Authentication & security

## When to use

Sign-in, tokens, sessions, accounts, role/permission checks, password handling, CORS/helmet, env/secrets, security review.

## Required knowledge

`docs/api-auth.md` (the contract), `docs/chat-logic-design.md` §3 and §6 (visibility and permission matrix), and the
`users`, `refresh_tokens` and `chat_users` models. **This backend owns authentication** (since 2026-11-07): it stores
accounts, hashes passwords and issues tokens. Roles: `CUSTOMER`, `AGENT`, `SUPERVISOR`, `ADMIN`.

## How it fits together

- `backend/src/modules/auth/`: `auth.password.ts` (scrypt), `auth.tokens.ts` (`AccessTokens`: HS256 JWT issue/verify,
  refresh-token generation and hashing), `auth.service.ts` (register, login, refresh with rotation and reuse detection,
  logout, password change, LOS sign-in), `auth.los.ts` (`LosTokenVerifier`: RS256 LOS tokens, one 401 for every
  failure), `user.service.ts` (admin account management, `UserDirectory`), `auth.repository.ts` (the
  only code touching `users`/`refresh_tokens`).
- `app-container.ts` builds `AccessTokens` and wraps it in `MappedAuthClient` (maps to `chat_users`, refuses disabled
  users). REST (`authenticate()` middleware) and the WebSocket gateway (`auth` frame) both use that one `authClient`.
- Staff sign in at `/api/v1/admin/auth`, customers at `/api/v1/customer/auth`; the service refuses the other kind
  (`Audience`). Sign-in/refresh/register are rate limited per IP (`shared/middleware/rate-limit.middleware.ts`).
- `AUTH_MODE=dev` additionally accepts `dev:<uuid>:<ROLE>` tokens (`DevOrJwtAuthClient`); env.ts refuses it in production
  and requires `JWT_SECRET` there.

## Workflow

1. Read `docs/api-auth.md`; keep it, the OpenAPI registration and the Postman collection in step with any change.
2. Authorization lives in services (ownership, role, handoff state), never only in routes or the UI; the DB backs it with
   CHECKs/unique indexes.
3. Test the allowed and denied paths: unauthenticated, wrong role, wrong audience, not owner, expired token, revoked or
   reused refresh token, disabled account.
4. Check nothing sensitive is logged or returned.

## Rules

- Passwords: only `hashPassword`/`verifyPassword` (scrypt, NFKC). Never log, return or store them in plaintext.
- Refresh tokens: store only `hashRefreshToken(token)`; rotate on every use; a reused token revokes its family. Do the
  family revocation **outside** a transaction that then throws, or the rollback undoes it.
- Access tokens: verify issuer, audience and algorithm (`HS256` only); any failure is a generic `401`.
- Sign-in errors stay generic (`Invalid email or password`) for unknown email, wrong password and wrong audience;
  spend a dummy hash for unknown emails (`burnPasswordCheck`).
- Disabling a user or changing a role revokes their sessions; disabling also updates `chat_users.status`.
- LOS tokens are accepted only at `POST /auth/los` (never as a bearer token), RS256 only, with issuer and audience
  checked. LOS-only accounts have no email or password; the DB CHECKs in `constraints.sql` keep that consistent.
- Secrets (`JWT_SECRET`, TURN secrets) come from env only; add new variables to `config/env.ts` and `.env.example`
  (names/placeholders only). The logger redacts `authorization` and `cookie` headers; keep it that way.

## Coding standards

zod-validate all external input (`.strict()` bodies); parameterized queries only (Prisma or `$queryRaw`/`$executeRaw`
tagged templates); helmet + explicit CORS origins from `CORS_ORIGIN`; `Cache-Control: no-store` on token responses.

## Common mistakes

Reading, printing or committing `.env` values; trusting client-sent ids/roles; plaintext tokens in the DB;
`$queryRawUnsafe`; UI-only permission checks; wildcard CORS with credentials; revealing which emails exist through
different sign-in errors or timing; parallel refreshes from one client (they look like token theft and sign the user out).
