---
name: database-design
description: Change the PostgreSQL schema, Prisma models, migrations and DB-level constraints. Use for any model, index, enum, migration or query-performance work.
---

# Database design

## When to use

Editing `backend/prisma/schema/*.prisma`, `backend/prisma/sql/constraints.sql`, migrations, or docs/database-schema.*.

## Required knowledge

PostgreSQL 16+, Prisma 7 (datasource URL lives in `backend/prisma.config.ts`, not the schema), the existing model in `docs/database-schema.md`.

## Workflow

1. Read the model docs and the domain file in `backend/prisma/schema/` (`01-identity-and-access.prisma` ... `11-moderation.prisma`, numbered like the DBML sections; generator and datasource are in `schema.prisma`). Reuse existing fields before adding new ones; a new model goes into its domain's file.
2. Edit the schema; `pnpm db:validate`, `pnpm db:generate`.
3. `pnpm db:migrate --create-only`, review the SQL, append anything from `constraints.sql` that Prisma cannot express (partial unique index, CHECKs, GIN full-text index), then `pnpm db:migrate`.
4. Update `docs/database-schema.md` and the domain file in `docs/database/` in the same change, then `pnpm db:dbml` to rebuild `docs/database-schema.dbml` (generated; a test fails when it is stale).

## Architecture rules

- Tables/columns are snake_case via `@map`/`@@map`; ids are `@db.Uuid` with `@default(uuid())`.
- `User` is the identity; `Customer` and `Agent` share its primary key (1:1).
- Messages are soft-deleted (`deleted_at`), never hard-deleted; `(conversation_id, client_id)` is the idempotency key.
- Invariants stay in the DB where possible (CHECKs, partial unique index for one active OWNER per conversation, FK `Restrict` on audit data).
- Migrations are append-only; never edit an applied migration.

## Coding standards

Index for the queries actually used (inbox: `handoff,last_message_at`; messages: `conversation_id,created_at`). Document every field with `///` comments as the schema already does.

## Testing requirements

Validate with `pnpm db:validate`; run migrations on a scratch database and exercise new constraints (insert violating rows) before merging.

## Common mistakes

- Reintroducing MySQL-isms (`@db.Char(36)`, `@@fulltext`, generated columns).
- Adding fields the protocol/docs never mention without documenting them.
- Running `db:migrate` against a shared or production database. Never commit `.env`.
