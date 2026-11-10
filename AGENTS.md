# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, Copilot). Reusable task guides live in
[.agents/skills/](.agents/skills/); read the matching `SKILL.md` before starting that kind of work.

## Project

Loan-support chat dashboard: customers talk to an AI assistant, which escalates to human agents.
pnpm monorepo (`pnpm-workspace.yaml`): `frontend/`, `backend/`, `packages/` (currently empty).
Node 22, pnpm 10 (pinned in `.mise.toml` and root `package.json`).

| Area        | Stack                                                                                                                   |
| ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| `frontend/` | React 19, TypeScript, Vite, Zustand 5, Tailwind 4, shadcn/ui (Base UI) in `shared/ui`, Vitest, oxlint, Prettier         |
| `backend/`  | Node 22, Express 5, TypeScript (ESM, `NodeNext`), Prisma 7 (`pg` adapter), PostgreSQL 16+, `ws`, Redis (`ioredis`), zod |

## Commands (run from repo root)

| Command                                                   | Purpose                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------- |
| `pnpm dev` / `pnpm dev:backend`                           | Frontend dev server / backend API (`tsx watch`)                     |
| `pnpm check`                                              | typecheck + lint + FSD check + format check + tests (what CI runs)  |
| `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm format` | Individual checks (all workspaces)                                  |
| `pnpm check:fsd`                                          | Frontend layer-boundary check                                       |
| `pnpm db:validate` / `db:generate` / `db:migrate`         | Prisma (runs in `backend/`, reads `backend/.env`)                   |
| `pnpm los:mock`                                           | Stand-in LOS on :4500 for "sign in with LOS" until LOS is connected |

## Source of truth (read these, do not restate them)

- Frontend layers and import rules: [FSD.md](FSD.md); UI conventions: [docs/DESIGN_PATTERNS.md](docs/DESIGN_PATTERNS.md)
- Data model and DB rules: [docs/database-schema.md](docs/database-schema.md), `backend/prisma/schema/` (one file per domain)
- Backend behaviour (flows, permissions, protocol gaps): [docs/chat-logic-design.md](docs/chat-logic-design.md)
- Mobile app integration (customer REST + socket flow): [docs/mobile-integration.md](docs/mobile-integration.md)
- WebSocket contract: backend [docs/websocket-events.md](docs/websocket-events.md); the frontend's `shared/api/ws/protocol.ts` is its own vocabulary, translated in `shared/api/ws/backend/`

## Architecture

- **Frontend:** Feature-Sliced Design, `app → pages → widgets → features → entities → shared`, `@/` = `src/`.
  Slices expose only `index.ts`; features never import features. Enforced by `pnpm check:fsd`.
- **Backend:** modular, one folder per domain under `backend/src/modules/<name>/`, each holding
  `<name>.routes.ts → .controller.ts → .service.ts → .repository.ts` (+ `.schema.ts` for zod, `.types.ts`, `.openapi.ts` for every module that exposes routes) and then
  Prisma → PostgreSQL. Cross-cutting code lives in `config/`, `database/`, `websocket/`, `shared/`
  (`errors/`, `middleware/`, `validators/`, `utils/`, `constants/`, `types/`; create a folder when first needed).
  `src/routes.ts` mounts module routers, served under `/api/v1/admin` (staff namespace; `/api/v1/customer` serves the mobile app, `/api/v1/dev` exists only with `AUTH_MODE=dev` for test sign-in with an LOS-style identity and no LOS, and `/api/v1/guest` is reserved). See [docs/backend-structure.md](docs/backend-structure.md).
  Only repositories query Prisma (the only exceptions are `server.ts` and `scripts/*.ts` calling `prisma.$disconnect()` on exit). Services own business rules and transactions. Controllers only
  validate input (via the `validate()` middleware) and shape the response. WebSocket handlers play the controller role:
  `ws handler → service → repository`. Modules call each other only through services, never repositories.
- **Realtime:** `backend/src/websocket/` serves `/ws` (clients authenticate with a first `auth` frame). Services report changes
  to `RealtimeService`, which publishes to an `EventBus` (Redis channel `chat:events`, or in-memory with `EVENT_BUS=memory`);
  each socket only receives events it may see. Services are built once in `backend/src/container.ts`.
  Frontend uses a built-in mock server unless `VITE_WS_URL` is set; with it, `BackendSocket` translates to the gateway's
  contract and REST supplies history and details (see `docs/frontend-integration.md`).

## Current state (keep docs honest)

- Backend implements `GET /api/health`, authentication and accounts: staff and customer sign-in (email and password, or an LOS token exchanged at `POST /auth/los`), registration for customers, JWT access + rotating refresh tokens, admin account management (`docs/api-auth.md`), roles and permissions as data with an admin API to edit them (`docs/api-roles.md`), the conversations, assignments, messages, notifications, presence and customer-info REST APIs (`docs/api-conversations.md`), the per-agent workspace API for tabs and drafts (`docs/api-workspace.md`), message actions: reply, edit, delete, reactions, forward (`docs/api-message-actions.md`), files, media and voice messages with local-disk storage (`docs/api-attachments.md`), internal notes with mentions and escalation (`docs/api-notes-escalations.md`), tags and conversation priority with inbox filtering and sorting (`docs/api-tags-priority.md`), personal and shared saved reply templates (`docs/api-canned-responses.md`), per-agent chat settings (`docs/api-chat-settings.md`), callbacks with a reminder job (`docs/api-callbacks.md`), call signalling for WebRTC calls (`docs/api-calls.md`; customers ring, answer, decline, cancel and end calls over `/api/v1/customer` REST, but customer sockets get no call events or signalling yet), spam reports, blocked customers and keywords (`docs/api-moderation.md`; enforced in the customer entry points), the customer mobile REST API under `/api/v1/customer`: join room, send text/file/voice, retrieve messages (`docs/api-customer-mobile.md`), customer sockets on `/ws` with `room.join`/`room.leave` and a restricted event set (`docs/websocket-events.md`), a
  notification service, the WebSocket gateway (first-frame auth, per-socket audience filtering, Redis/in-memory event bus; contract in `docs/websocket-events.md`), presence and the Prisma schema. Push notifications and the AI worker are **designed in docs but not built**. Do not describe
  them as existing.
- **This backend owns authentication** (since 2026-11-07; it used to be an external service). It stores accounts in
  `users` with scrypt hashes, issues HS256 access tokens and rotating refresh tokens (only their SHA-256 is stored, in
  `refresh_tokens`), and admins manage accounts. It also accepts RS256 tokens signed by LOS (Backend 1) as a sign-in
  (`docs/api-auth.md`, "Sign in with LOS"; LOS-only accounts have no email or password). Never store or log plaintext
  passwords or tokens. Loan data (national id, salary, ...) still belongs to Backend 1, whose loan-data API is **not yet
  known**; do not invent it. See
  `authentication-security` and `docs/api-auth.md`.
- The backend has Vitest (`pnpm test` runs it, with 70/70/70/65 coverage thresholds via `test:coverage`) but no lint or
  format scripts, so also run `pnpm --filter @chat-dashboard/backend build` and `npx prettier --check backend/src`.
  Integration tests (`*.integration.test.ts`) run against PostgreSQL only when `TEST_DATABASE_URL` points at a database whose name contains "test" (the migration applied), and the WebSocket ones also need `TEST_REDIS_URL` (a throwaway Redis, it is flushed); otherwise they are skipped. `packages/` is empty, so the backend cannot import frontend types;
  the protocol is currently defined only in the frontend.

## Rules

- Follow the existing architecture; do not rewrite working features or refactor unrelated code.
- Never invent APIs, database fields, events or business rules. If it is not in the schema, protocol or
  `docs/chat-logic-design.md`, propose it first and update the docs and protocol together with the code.
- Schema changes go through a Prisma migration; DB-level rules Prisma cannot express go in `backend/prisma/sql/constraints.sql`.
  `backend/prisma/generated/` is generated and git-ignored; never edit it.
- Never read, print or commit secrets. `.env*` is git-ignored except `backend/.env.example`; add new variables there
  (names/placeholders only) and to `backend/src/config/env.ts`.
- Backend imports use `.js` extensions (ESM `NodeNext`). Express 5 forwards async errors; no `try/catch` just to call `next`.
- Match surrounding style: Prettier (120 cols, trailing commas), TypeScript `strict`, no `any`.
- Add or update tests with behaviour changes, and run `pnpm check` before declaring work done.
- Keep docs consistent with the implementation in the same change.
  `backend/src/__tests__/docs-consistency.test.ts` fails when a REST route is missing from the Postman collection, a WebSocket
  event from `docs/websocket-events.md`, an env variable from `.env.example` or the docs, or an `api-*.md` guide from this file.

## Skills

Load the skills that match the task (a feature usually needs several):

| Skill                     | Use for                                                               |
| ------------------------- | --------------------------------------------------------------------- |
| `frontend-development`    | anything in `frontend/`                                               |
| `backend-development`     | services, repositories, config in `backend/src/`                      |
| `api-development`         | REST endpoints under `/api/v1/admin`                                  |
| `websocket-development`   | new/changed realtime events (spans protocol, gateway, frontend, mock) |
| `database-design`         | schema, migrations, constraints                                       |
| `authentication-security` | auth, sessions, permissions, secrets                                  |
| `testing`                 | writing tests, verifying work                                         |
| `code-review`             | reviewing a diff before finishing                                     |
