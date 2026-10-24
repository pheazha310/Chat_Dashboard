# Chat Dashboard

React 19 + TypeScript + Vite dashboard for handling customer chat conversations, with AI/human handoff, in-chat search, shared media & files and an applications workspace.

## Getting started

Requires Node 22 and pnpm (versions pinned in `.mise.toml` / `package.json`).

```sh
pnpm install
cp .env.example .env
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
