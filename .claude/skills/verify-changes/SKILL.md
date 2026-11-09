---
name: verify-changes
description: Run the repo's full verification (typecheck, lint, FSD check, format, tests, build) and report real results. Use before declaring a task done or when asked to verify.
disable-model-invocation: true
---

Run from the repo root and report each step's actual outcome (quote failures; never claim a pass you didn't see):

1. `pnpm check`
2. `pnpm build` and `npx prettier --check backend/src` (backend has no format script)
3. If anything in `backend/prisma/schema/` changed: `pnpm db:validate`

If something fails, fix only what your change caused; mention unrelated pre-existing failures instead of fixing them.
