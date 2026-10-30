# Chat Dashboard

React 19 + TypeScript + Vite dashboard for handling customer chat conversations, with AI/human handoff, in-chat search, shared media & files and an applications workspace.

## Getting started

Requires Node 22 and pnpm (versions pinned in `.mise.toml` / `package.json`).

```sh
pnpm install
cp frontend/.env.example frontend/.env
pnpm dev
```

`VITE_WS_URL` sets the WebSocket endpoint. Leave it empty to use the built-in mock server (`src/shared/api/ws/mock`).

## Scripts

| Script | Purpose |
| --- | --- |
| `pnpm dev` / `build` / `preview` | Vite dev server, production build, preview |
| `pnpm test` | Vitest |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` / `lint:fix` | oxlint |
| `pnpm format` / `format:check` | Prettier |
| `pnpm check:fsd` | Layer-boundary check |
| `pnpm check` | All of the above checks (run in CI) |

## Architecture

Feature-Sliced Design: `app → pages → widgets → features → entities → shared`. See [FSD.md](FSD.md) for layer responsibilities and import rules, which `pnpm check:fsd` enforces.

## Backend

Backend database code lives in `backend/`, a pnpm workspace package.
The Prisma schema, SQL constraints, and database client are in `backend/prisma/`;
Prisma configuration is in `backend/prisma.config.ts`.

```sh
cp backend/.env.example backend/.env
# Set DATABASE_URL in backend/.env to your MySQL connection URL.
pnpm db:validate
pnpm db:generate
pnpm db:migrate
```

Run these commands from the repository root. They run Prisma in the backend
package, which loads `backend/.env`. See [database setup](docs/database-schema.md)
for the additional SQL constraints to apply to the first migration.
