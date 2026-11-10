@AGENTS.md

## Claude Code notes

- Project skills in `.claude/skills/` are symlinks to `.agents/skills/` (edit the originals, never the links),
  plus the Claude-only `verify-changes` skill.
- Prefer the dedicated Read/Edit/Grep tools over shell equivalents; use `pnpm --filter @chat-dashboard/<pkg> <script>` to scope commands.
- Ask before running `pnpm db:migrate` against a database you did not create, or any destructive git/DB command.
- Before writing, reviewing or refactoring code, load the `andrej-karpathy-skills:karpathy-guidelines` skill and follow it.
- Build features and fix bugs test-first: load the `tdd` skill and work red → green → refactor (write a failing test,
  make it pass, then clean up).
