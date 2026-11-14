# Deployment (DEV and STG)

How the Chat Dashboard is built, shipped and run next to LOS on the shared GCP server. Follows the LOS
`DEPLOYMENT.md` conventions (Jenkins on a Mac, Docker, host Nginx, `nak` → Dev, `staging` → Staging, blue-green on
Staging). **Production is out of scope.** Everything below marked **PROPOSED** is a choice made here, not something
the company confirmed; those are collected in [section 10](#10-open-questions-for-the-los-and-infra-team).

What was verified and what was not is in [section 9](#9-testing-checklist).

## 1. Architecture

```
Internet ── host Nginx (shared with LOS, TLS) ──┬─ /      → chatdash web   (Nginx container, static React build)
                                                ├─ /api/  → chatdash api   (Express 5, REST for dashboard + mobile)
                                                └─ /ws    → chatdash api   (native WebSocket)
                                   private Docker network chatdash_<env>_net
                                   chatdash api ──→ postgres 17 (own volume)   ──→ redis 7 (own volume)
                                   chatdash api ──→ S3-compatible store (HTTPS, credentials server-side only)
                                   chatdash api ──→ LOS API (JWKS, loan data), outbound only
```

One public host per environment serves web, `/api` and `/ws` (same origin: no CORS surprises, one certificate).
The mobile app uses `https://<host>/api/v1/customer` and `wss://<host>/ws`.

| Unit (Compose project)         | Contains             | Lifetime                             |
| ------------------------------ | -------------------- | ------------------------------------ |
| `chatdash-<env>-infra`         | Postgres 17, Redis 7 | Persistent. A deploy never recreates |
| `chatdash-dev`                 | api + web            | Dev: one set, replaced in place      |
| `chatdash-stg-blue` / `-green` | api + web            | Staging: one live, one idle slot     |

`<env>` is `dev` or `stg`. DEV and STG have separate databases, Redis, volumes, networks, env files and buckets.

### Isolation from LOS (shared host)

- Every Docker object is named `chatdash-*` / `chatdash_*` (projects, networks, volumes, image repos). LOS uses
  `los_backend_*` and `los-app`. No explicit `container_name` is used.
- Scripts only run Compose against the projects above: no `--remove-orphans`, no `down -v`, no `docker prune`.
  Image cleanup removes only old `chatdash-*:<env>-<sha>` tags (keeps 3).
- Postgres and Redis publish **no ports**. api/web publish on `127.0.0.1` only; Nginx is the single entry.
- Host ports (**PROPOSED**; LOS uses 3000, 3001, 3010, 3011): DEV api 4100 / web 4101; STG blue 4201/4202,
  green 4211/4212. Scripts refuse to start if a port is held by something that is not our own project.
- Nginx: our own file(s) with their own `chatdash_*` upstream and `map` names. We never edit LOS server blocks.
  The only shared-Nginx action is `nginx -t` then a graceful `nginx -s reload` at a flip.
- Deploy directories (**PROPOSED**): `/home/ubuntu/chatdash-dev`, `/home/ubuntu/chatdash-staging` (LOS: `los_backendv2`,
  `los-staging`, `los-prod`). Each is a git checkout holding its own untracked env file and `.deploy/` state.
- Every script stops below 10 GB free disk (the LOS rule).

## 2. Files

| Path                                                | Purpose                                                                           |
| --------------------------------------------------- | --------------------------------------------------------------------------------- |
| `backend/Dockerfile`                                | API image (`runtime`) and one-shot `migrate` target                               |
| `frontend/Dockerfile`, `frontend/nginx/`            | Web image: Vite build served by unprivileged Nginx, CSP template                  |
| `.dockerignore`                                     | Keeps `.env*`, `.git`, local storage out of the build context                     |
| `deployment/compose/infra.yml`, `app.yml`           | Postgres + Redis; api + web                                                       |
| `deployment/nginx/chatdash.conf.template`           | Host Nginx server block (TLS, `/ws`, `/api/`, `/`)                                |
| `deployment/dev/env.example`, `staging/env.example` | Server-side env files (placeholders only)                                         |
| `deployment/scripts/`                               | `deploy-dev`, `deploy-staging`, `rollback-*`, `smoke-test`, `render-nginx`, `lib` |
| `Jenkinsfile`                                       | Checks on every branch; deploy on `nak` / `staging`                               |

The task suggested `client/` and `server/`; the repo's real directories are `frontend/` and `backend/`, so the
Dockerfiles live there. Build context is always the repo root (pnpm workspace).

Code change: `S3_ACCESS_KEY` / `S3_SECRET_KEY` (both or neither; unset uses the standard AWS chain as before). Nothing
else in the application changed.

## 3. Configuration

Copy `deployment/<env>/env.example` to the deploy directory as `.env.dev` / `.env.staging` (git-ignored), replace
every `CHANGE_ME`. The scripts refuse to run with placeholders, empty required values, or `CORS_ORIGIN` ≠
`CHAT_PUBLIC_ORIGIN` (the gateway checks the browser `Origin` against `CORS_ORIGIN`).

- API: `NODE_ENV=production`, `AUTH_MODE=jwt`, `BACKEND1_MODE=local`, `EVENT_BUS=redis`, `TRUST_PROXY=1` (one Nginx hop),
  `JWT_SECRET` ≥ 32 random chars (`openssl rand -base64 48`). The API listens on all interfaces inside its container.
- Web: Vite inlines `VITE_WS_URL`, `VITE_API_URL`, `VITE_LOS_WEB_ORIGIN` at **build** time, derived by the script
  from `CHAT_PUBLIC_ORIGIN` and `LOS_WEB_ORIGIN`. Nothing secret is ever a `VITE_*` value.
- Storage: `STORAGE_DRIVER=s3` with `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`,
  `S3_FORCE_PATH_STYLE` (true for MinIO-style stores). One bucket per environment. Credentials stay in the API container.
- LOS values (`LOS_ISSUER`, `LOS_JWKS_URL`, `LOS_BASE_URL`, audiences, role map): see [api-auth.md](api-auth.md). Dev and
  Staging LOS sign with different keys, so `LOS_JWKS_URL` must be on the same host as `LOS_BASE_URL` (the API enforces it).

## 4. Database (PostgreSQL 17) and Redis

- Schema changes are Prisma migrations, applied by `prisma migrate deploy` in a one-shot container on the
  environment's private network, **before** the new code starts. It only applies committed migrations; it never resets,
  drops or runs `migrate dev`. Unlike LOS Staging (hand-run SQL, freelancer schema), the Chat database is ours, so Prisma
  owns it on DEV and STG.
- Migrations run while the old slot still serves. Keep them **expand-only** (add columns/tables); do the drop/rename
  in a later release, as in the LOS guide.
- STG takes `pg_dump -Fc` to `.deploy/backups/` before each migration (last 5 kept). Restore is manual:
  `docker exec -i <postgres container> pg_restore -U <user> -d <db> --clean --if-exists < dump`. Run it only deliberately.
- Redis has a password, append-only persistence and a named volume. It carries realtime pub/sub between slots, so during
  the cutover both slots hear every event.
- Background jobs (callback reminders, call timeouts, session cleanup) run inside every API process. During the
  seconds of overlap both slots run them. **Unverified** whether each is idempotent; check before relying on STG
  blue-green with callbacks pending.

## 5. Nginx (one-time setup per environment, done by a person)

1. `CHAT_ENV=stg CHAT_SERVER_NAME=<host> SSL_CERT=<path> SSL_KEY=<path> deployment/scripts/render-nginx.sh > chatdash-stg.conf`
2. Read it, put it where the host Nginx loads site files (`conf.d` or `sites-enabled`: check how LOS does it), keeping a
   file name that starts with `chatdash-`.
3. Create the include directory owned by the deploy user: `/etc/nginx/chatdash/` (override with `NGINX_UPSTREAM_FILE`).
4. Allow the deploy user `sudo nginx -t` and `sudo nginx -s reload` only (override with `NGINX_TEST_CMD`, `NGINX_RELOAD_CMD`).
5. The first deploy writes `<env>-upstream.inc`; `nginx -t` must pass before anything reloads.

Behaviour: HTTP→HTTPS redirect; `client_max_body_size 30m` (API cap is 25 MiB); `/ws` upgrades with 1 h timeouts and no
buffering; `/api/` streams uploads. The web container sets `Content-Security-Policy: frame-ancestors 'self' <LOS web origin>`
(enforced, this is the iframe restriction; `X-Frame-Options` is deliberately absent) plus a full CSP in **Report-Only**
mode until it has been checked in a browser against the real app. Not added: HSTS (decide with infra).

## 6. Deploying

### DEV (`nak`, automatic)

Jenkins: checks (install, Prisma generate, lint, typecheck, FSD, format, unit tests, optional integration, build) →
SSH → fast-forward the checkout to `nak` → `deployment/scripts/deploy-dev.sh` → `smoke-test.sh`.
The script: validate env, disk and ports → Postgres/Redis up (idempotent) → build images tagged `dev-<sha>` →
`migrate deploy` → `up -d` → health gate on `/api/health` and the web `/healthz` (60 s) → record tag. If unhealthy
it restores the previous image (applied migrations stay). Manual: `deployment/scripts/rollback-dev.sh [tag]`.

### STG (`staging`, automatic, blue-green)

Same entry, `deploy-staging.sh`: build `stg-<sha>` → `pg_dump` → migrate → start the **idle** slot → health gate on that
slot directly → write the upstream include → `nginx -t` + reload → smoke test through Nginx (flip back on failure) →
drain the old slot (waits up to 60 s for its connections) → remove it → record tag, prune. Any failure before the
flip removes the new slot and leaves the live one untouched. Manual: `deployment/scripts/rollback-staging.sh [tag]`
(a normal cutover to the previous image; it keeps the last 3 images). Rollback restores code, **not** data or migrations.

### WebSocket

Clients reconnect and rejoin on their own when a slot goes away (the API process exits and sockets drop; the frontend
`BackendSocket` and the mobile app resync history after reconnect, see [mobile-integration.md](mobile-integration.md)).
Not changed or verified here: `server.ts` closes listeners and exits without waiting for in-flight HTTP requests; the
drain step above mitigates it, since traffic has already moved.

## 7. LOS integration

Already implemented in the application; deployment only has to supply the right values. Do not restate the contracts:

- Staff: iframe hand-off, `postMessage` rules, session length → [frontend-integration.md](frontend-integration.md) ("Embedded in LOS Web"),
  `POST /api/v1/admin/auth/los` in [api-auth.md](api-auth.md). Origins are exact (no wildcard) on both sides
  (`VITE_LOS_WEB_ORIGIN`/`LOS_WEB_ORIGIN`/`CHAT_WEB_ORIGIN`); the hand-off token is never stored or put in a URL.
- Customers/mobile: [mobile-integration.md](mobile-integration.md), [api-customer-mobile.md](api-customer-mobile.md).
- Identity mapping and no duplicates: `external_identities`, explicit link/unlink, audit trail → [standalone-mode.md](standalone-mode.md).
- Token checks (RS256 signature via JWKS, issuer, audience, expiry, token type, max age): `backend/src/config/env.ts`, [api-auth.md](api-auth.md).

Changes needed in `los_web` (not made here): add the Chat dashboard origin to the iframe `src` and to its allowed
frame sources; answer `TOKEN_REQUEST` with `HANDOFF_TOKEN` only to the exact Chat origin and only to its own iframe
window; issue the hand-off token (`aud` `chat`, `tokenType` `chat-handoff`, short `exp`, `jti`).
Changes needed in the mobile app: base URL of the Chat host, sign-in with the LOS customer token at
`/api/v1/customer/auth/los`, and the reconnect/resync behaviour in the mobile guide.

## 8. Rollout order for a new environment

1. Infra/LOS team answers [section 10](#10-open-questions-for-the-los-and-infra-team).
2. Create DNS name, certificate, the S3 bucket and keys, the deploy directory and the env file.
3. Nginx one-time setup ([section 5](#5-nginx-one-time-setup-per-environment-done-by-a-person)).
4. Create the Jenkins job and credentials named in the `Jenkinsfile`.
5. Push the branch; read the log, then the smoke test; then do the manual checks below.

## 9. Testing checklist

**Executed locally in this change** (Docker Desktop on a Mac, throwaway env file, fake LOS values, local storage, then
torn down; nothing touched a real server):

- Backend and web images build; the `migrate` image applied all 22 migrations on an empty Postgres 17.
- `deploy-dev.sh` end to end: infra, build, migrate, start, health gate. `/api/health` = database up, redis up.
- Web container serves the SPA and the `frame-ancestors` CSP; no `X-Frame-Options`.
- Rendered Nginx config passes `nginx -t`; through it: `/`, `/api/health`, anonymous staff API → 401, dev sign-in route → 404,
  WebSocket upgrade → 101 (and a wrong `Origin` is refused), via `smoke-test.sh` (7/7).
- `deploy-staging.sh` twice: blue→green flip rewrote the upstream include, old slot drained and removed.
  A forced unhealthy slot was removed and the live slot and upstream stayed untouched. Rollback to a missing image is refused.
- Backend unit tests for the new S3 settings; typecheck.

**Not executed** (needs the real server, LOS or credentials; do not assume they pass):

- Anything on the GCP host: port availability, disk, the real Nginx reload, sudo rights, Telegram.
- The Jenkinsfile (never run in Jenkins).
- S3-compatible storage upload/download, with real endpoint and keys.
- Real LOS: staff hand-off from `los_web`, JWKS validation, customer sign-in from the mobile app, role mapping,
  logout and expiry in the iframe, identity mapping against real LOS ids, existing LOS features unaffected.
- The report-only CSP against the live UI (watch the console for violations before enforcing it).
- Callback/call jobs during blue-green overlap; WebSocket reconnect and room rejoin during a real flip.
- File and voice upload through Nginx at the size limit.

Manual after each deploy: sign in from `los_web`, open a conversation, send text + a file + a voice note from the app, see
them arrive live, reload during a deploy and confirm the socket reconnects; sign out and confirm the session ends.

## 10. Open questions for the LOS and infra team

Infrastructure: chat host names for DEV and STG (not `api-*.los.*`); how certificates are issued and their paths; whether
Nginx loads `conf.d` or `sites-enabled`; sudo for `nginx -t`/reload; which host ports are really free (4100-4101,
4201-4202, 4211-4212 proposed); deploy directory names and the SSH user; free disk and RAM on the shared server;
whether Postgres/Redis may run as containers there or managed instances exist; the S3-compatible provider, endpoints,
buckets, regions, keys and whether path-style addressing is required; Jenkins job/credential naming and whether
Jenkins may SSH as the same user; Telegram chat for these deploys; a TURN/STUN server for calls.

LOS (unchanged from the existing integration docs, still open): `iss`, JWKS URL and `aud` values per environment;
the hand-off token (`aud` `chat`, `tokenType`, `jti`) and when `los_web` will issue it; the `postMessage` protocol
(proposed in [frontend-integration.md](frontend-integration.md)); LOS staff role names and the mapping to
AGENT/SUPERVISOR/ADMIN; the machine-to-machine `/integration/chat/*` access (`LOS_SERVICE_API_KEY`, allowed IPs); the
loan-data API for Backend 1 (the Chat API does not invent it); staff and customer id formats used for identity linking.
