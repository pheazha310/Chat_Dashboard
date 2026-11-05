# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, Copilot). Reusable task guides live in
[.agents/skills/](.agents/skills/); read the matching `SKILL.md` before starting that kind of work.

## Project

Loan-support chat dashboard: customers talk to an AI assistant, which escalates to human agents.
pnpm monorepo (`pnpm-workspace.yaml`): `frontend/`, `backend/`, `packages/` (currently empty).
Node 22, pnpm 10 (pinned in `.mise.toml` and root `package.json`).

| Area        | Stack                                                                                                                   |
| ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| `frontend/` | React 19, TypeScript, Vite, Zustand 5, Tailwind 4, Vitest, oxlint, Prettier                                             |
| `backend/`  | Node 22, Express 5, TypeScript (ESM, `NodeNext`), Prisma 7 (`pg` adapter), PostgreSQL 16+, `ws`, Redis (`ioredis`), zod |

## Commands (run from repo root)

| Command                                                   | Purpose                                                            |
| --------------------------------------------------------- | ------------------------------------------------------------------ |
| `pnpm dev` / `pnpm dev:backend`                           | Frontend dev server / backend API (`tsx watch`)                    |
| `pnpm check`                                              | typecheck + lint + FSD check + format check + tests (what CI runs) |
| `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm format` | Individual checks (all workspaces)                                 |
| `pnpm check:fsd`                                          | Frontend layer-boundary check                                      |
| `pnpm db:validate` / `db:generate` / `db:migrate`         | Prisma (runs in `backend/`, reads `backend/.env`)                  |

## Source of truth (read these, do not restate them)

- Frontend layers and import rules: [FSD.md](FSD.md); UI conventions: [docs/DESIGN_PATTERNS.md](docs/DESIGN_PATTERNS.md)
- Data model and DB rules: [docs/database-schema.md](docs/database-schema.md), `backend/prisma/schema.prisma`
- Backend behaviour (flows, permissions, protocol gaps): [docs/chat-logic-design.md](docs/chat-logic-design.md)
- WebSocket contract: `frontend/src/shared/api/ws/protocol.ts` (`ServerEventMap`, `ClientEventMap`, `isServerEvent`)

## Architecture

- **Frontend:** Feature-Sliced Design, `app → pages → widgets → features → entities → shared`, `@/` = `src/`.
  Slices expose only `index.ts`; features never import features. Enforced by `pnpm check:fsd`.
- **Backend:** modular, one folder per domain under `backend/src/modules/<name>/`, each holding
  `<name>.routes.ts → .controller.ts → .service.ts → .repository.ts` (+ `.schema.ts` for zod, `.types.ts`, `.openapi.ts` for every module that exposes routes) and then
  Prisma → PostgreSQL. Cross-cutting code lives in `config/`, `database/`, `websocket/`, `shared/`
  (`errors/`, `middleware/`, `validators/`, `utils/`, `constants/`, `types/`; create a folder when first needed).
  `src/routes.ts` mounts module routers under `/api`. See [docs/backend-structure.md](docs/backend-structure.md).
  Only repositories query Prisma (the one exception is `server.ts` calling `prisma.$disconnect()` on shutdown). Services own business rules and transactions. Controllers only
  validate input (via the `validate()` middleware) and shape the response. WebSocket handlers play the controller role:
  `ws handler → service → repository`. Modules call each other only through services, never repositories.
- **Realtime:** `backend/src/websocket/websocket.server.ts` serves `/ws` and fans events out through Redis channel `chat:events`.
  Frontend uses a built-in mock server unless `VITE_WS_URL` is set.

## Current state (keep docs honest)

- Backend implements `GET /api/health`, the conversations, assignments and messages REST APIs (`docs/api-conversations.md`), a
  notification service, the WS gateway relay (no auth, no event handlers) and the Prisma schema. The customer channel, presence and
  typing, customer info, notification endpoints, realtime events and the AI worker are **designed in docs but not built**. Do not describe
  them as existing.
- **Authentication is an external service** (separate repo). This backend only consumes it: it must not issue tokens,
  store passwords, or implement login. The service's API contract (token format, verify/introspect endpoint, user/role
  claims) is **not yet known**; do not invent it. See `authentication-security`.
- The backend has Vitest (`pnpm test` runs it, with 70/70/70/65 coverage thresholds via `test:coverage`) but no lint or
  format scripts, so also run `pnpm --filter @chat-dashboard/backend build` and `npx prettier --check backend/src`.
  Integration tests (`*.integration.test.ts`) run against PostgreSQL only when `TEST_DATABASE_URL` points at a database whose name contains "test" (the migration applied); otherwise they are skipped. `packages/` is empty, so the backend cannot import frontend types;
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

## Skills

Load the skills that match the task (a feature usually needs several):

| Skill                     | Use for                                                               |
| ------------------------- | --------------------------------------------------------------------- |
| `frontend-development`    | anything in `frontend/`                                               |
| `backend-development`     | services, repositories, config in `backend/src/`                      |
| `api-development`         | REST endpoints under `/api`                                           |
| `websocket-development`   | new/changed realtime events (spans protocol, gateway, frontend, mock) |
| `database-design`         | schema, migrations, constraints                                       |
| `authentication-security` | auth, sessions, permissions, secrets                                  |
| `testing`                 | writing tests, verifying work                                         |
| `code-review`             | reviewing a diff before finishing                                     |
