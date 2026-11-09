# Copilot instructions

Follow [AGENTS.md](../AGENTS.md); it is the single source of truth for architecture, commands and rules.
Task guides are in [.agents/skills/](../.agents/skills/).

Essentials:
- Frontend (`frontend/`): React 19 + TypeScript, Feature-Sliced Design (`app → pages → widgets → features → entities → shared`), Zustand stores, `@/` alias. Import other slices only via their `index.ts`; features never import features. See `FSD.md`.
- Backend (`backend/`): Express 5, Prisma 7, PostgreSQL, `ws`, Redis. Layering is Routes → Controller → Service → Repository → Prisma; only repositories use Prisma. Use `.js` extensions in relative imports.
- The WebSocket contract is `frontend/src/shared/api/ws/protocol.ts`. Database model: `backend/prisma/schema/` (one file per domain).
- Do not invent endpoints, events, DB fields or business rules. Never include secrets or `.env` values.
- Add tests next to the code (Vitest) and make sure `pnpm check` passes. The backend has no lint/test scripts yet: also run `pnpm --filter @chat-dashboard/backend build`.
