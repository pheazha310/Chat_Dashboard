# Database Schema Design — Chat Dashboard

## Overview

The persistent data model behind the Chat Dashboard. It is defined in
`prisma/schema.prisma` and targets **MySQL 8.0.16+** (Prisma 7). It normalizes
entities that are currently embedded in the client DTOs (`ConversationDto`,
`ChatMessageDto`, `ActivityDto` in `frontend/src/shared/api/ws/protocol.ts`).

Related files:

| File | Purpose |
|---|---|
| `prisma/schema.prisma` | Source of truth for tables, columns, relations, enums |
| `prisma/sql/constraints.sql` | Constraints Prisma cannot express; append to the first migration |
| `prisma.config.ts` | Prisma 7 config (schema path, `DATABASE_URL`) |
| `prisma/client.ts` | `PrismaClient` with the MariaDB/MySQL driver adapter |
| `docs/database-schema.dbml` | Same schema for https://dbdiagram.io/d |

Tables are snake_case plural (`users`, `agent_conversations`); in code use the
Prisma names (`prisma.user`, `lastMessageAt`).

## Entity Relationship Diagram

```
users ──1:1── customers ──< applications ──1:1── conversations
  │                │                                │  │  │
  │                └──< conversations >─────────────┘  │  ├──< messages >── users (sender)
  │                                                    │  ├──< activities
  └──1:1── agents ──< agent_conversations >────────────┘  └──< shared_files
             │  └──< conversations (assigned_agent_id)
             ├──< notifications
             ├──< settings
             └──< activities
```

## Design decisions

1. **One `users` table for identity.** Name, avatar, email, password hash and
   role live on `users`. `customers` and `agents` are 1:1 profile tables that
   share the user's id (`customers.id = users.id`).
2. **Two sources of "who owns this chat" are kept in sync.** `conversations.assigned_agent_id`
   is the fast read path for the inbox; `agent_conversations` is the append-only history.
3. **`handoff` is the AI-to-human state machine**, separate from the lifecycle `status`:

   ```
   AI ──(escalate / callback / customer asks)──▶ NEEDS_HUMAN ──(takeover)──▶ ASSIGNED
    ▲                                                                           │
    └──────────────────────────(release / resolve)──────────────────────────────┘
   ```
4. **Messages are append-only.** Soft delete via `deleted_at`; `client_id` makes
   optimistic sends idempotent (unique with `conversation_id`).
5. **Denormalized inbox fields** (`preview`, `last_message_at`, `unread_count`)
   are updated in the same transaction as the message insert.
6. **Display strings are derived.** Money is `DECIMAL`, tenor is days, file size
   is bytes, and `Activity.time` / `SharedFile.addedAt` come from `created_at`.
   The server formats them when building DTOs.

## Tables

### users
| Column | Type | Notes |
|---|---|---|
| `id` | CHAR(36) PK | uuid |
| `name` | VARCHAR(150) | |
| `avatar` | VARCHAR(512)? | URL |
| `email` | VARCHAR(255)? unique | |
| `role` | ENUM | `CUSTOMER`, `AGENT`, `SUPERVISOR`, `ADMIN` |
| `password_hash` | VARCHAR(255)? | null for customers / SSO-only staff |
| `active` | BOOLEAN | account enabled |
| `last_login_at`, `created_at`, `updated_at` | DATETIME | |

### customers (profile, `id` = `users.id`)
`phone`, `national_id`, `salary`, `occupation`, `blacklisted`, timestamps.

### agents (profile, `id` = `users.id`)
`available` (accepting new chats; distinct from `users.active`), timestamps.

### applications
| Column | Type | Notes |
|---|---|---|
| `id` | CHAR(36) PK | |
| `app_id` | VARCHAR(64) unique | e.g. `61831` |
| `customer_id` | CHAR(36) | required, RESTRICT |
| `reference` | VARCHAR(100) unique | e.g. `LUL-61831-MAYA` |
| `product` | VARCHAR(150) | |
| `amount`, `currency` | DECIMAL(12,2), CHAR(3) | |
| `tenor_days` | INT | |
| `loan_request`, `completeness` | VARCHAR? | |
| `status` | ENUM | `NEW`, `REVIEWING`, `COMPLETED`, `FAILED`, `PAID_OFF`, `IN_PROGRESS`, `OVERDUE` |
| `registered_at`, timestamps | DATETIME | |

### conversations
| Column | Type | Notes |
|---|---|---|
| `id` | CHAR(36) PK | |
| `slug` | VARCHAR(100) unique | external id the WS protocol uses today (e.g. `maya`) |
| `customer_id` | CHAR(36) | required |
| `application_id` | CHAR(36)? unique | 1:1 with an application |
| `status` | ENUM | `OPEN`, `RESOLVED`, `CLOSED` |
| `closed_at` | DATETIME? | set exactly when `status != OPEN` (CHECK) |
| `channel` | VARCHAR(32) | default `web` |
| `handoff` | ENUM | `AI`, `NEEDS_HUMAN`, `ASSIGNED` |
| `assigned_agent_id` | CHAR(36)? | set exactly when `handoff = ASSIGNED` (CHECK) |
| `preview`, `last_message_at`, `unread_count`, `urgent` | | inbox fields |
| `summary`, `summary_image` | TEXT?, VARCHAR? | |

### messages
| Column | Type | Notes |
|---|---|---|
| `id` | CHAR(36) PK | |
| `conversation_id` | CHAR(36) | CASCADE |
| `sender_type` | ENUM | `CUSTOMER`, `ASSISTANT`, `AGENT` |
| `sender_user_id` | CHAR(36)? | NULL exactly when `ASSISTANT` (CHECK); RESTRICT |
| `type` | ENUM | `TEXT`, `IMAGE`, `FILE`, `NOTE` (internal), `SYSTEM` |
| `text` | TEXT | |
| `client_id` | VARCHAR(64)? | unique with `conversation_id` |
| `status` | ENUM? | `SENDING`, `SENT`, `DELIVERED`, `READ`, `FAILED` |
| `created_at`, `edited_at`, `deleted_at` | DATETIME | |

### activities
`id`, `conversation_id` (CASCADE), `agent_id`? (SET NULL), `tone` (`BLUE`/`CYAN`/`RED`), `title`, `copy`, `created_at`.

### agent_conversations (assignment history)
`agent_id`, `conversation_id`, `role` (`OWNER`/`VIEWER`), `assigned_at`, `unassigned_at`
(NULL = currently assigned). Both foreign keys are RESTRICT so history survives.
`active_owner_key` is a **generated column** (never write to it) with a UNIQUE
index: it holds `conversation_id` while the row is the active OWNER, so a chat
can have only one active owner.

### shared_files
`conversation_id` (CASCADE), `customer_id`, `application_id`?, `message_id`?,
`name`, `kind` (`DOCUMENT`/`IMAGE`), `size_bytes`, `mime_type`?, `url`, `created_at`.

### settings / notifications
`settings`: one boolean per `(agent_id, key)`. `notifications`: `agent_id`, `type`,
`text`, `read`, `created_at`.

## Database-enforced rules

| Rule | Mechanism |
|---|---|
| `handoff = ASSIGNED` ⇔ `assigned_agent_id` set | CHECK |
| `status = OPEN` ⇔ `closed_at` is NULL | CHECK |
| `ASSISTANT` message ⇔ no `sender_user_id` | CHECK |
| One active OWNER per conversation | generated column + UNIQUE |
| No duplicate optimistic sends | UNIQUE `(conversation_id, client_id)` |
| Users with messages, agents on chats, chats with assignment history can't be deleted | FK RESTRICT |

CHECKs need **MySQL 8.0.16+**; older versions parse them and silently ignore them.

Not enforced by the database (do it in the application): `users.role` matching
the presence of a `customers` / `agents` row, and the sender's role matching
`sender_type`.

## Workflows

**Customer message:** insert message → update conversation (`preview`,
`last_message_at`, `unread_count + 1`) in one transaction → if `handoff = AI`,
queue the AI reply; if it escalates, set `NEEDS_HUMAN`, `urgent`, and notify agents.

**Takeover (race-safe):**
```sql
UPDATE conversations
SET handoff = 'ASSIGNED', assigned_agent_id = ?
WHERE id = ? AND handoff = 'NEEDS_HUMAN';   -- 0 rows affected = someone else won
```
In the same transaction, close any open owner row (`unassigned_at = NOW()`) and
insert the new `agent_conversations` row.

**Agent message:** validate ownership → insert → `message.ack` maps `client_id`
to the real id → `message.status` updates.

## Setup

```bash
pnpm add -D prisma && pnpm add @prisma/client @prisma/adapter-mariadb dotenv
export DATABASE_URL="mysql://user:pass@localhost:3306/chat"
pnpm exec prisma generate                      # client -> prisma/generated/prisma
pnpm exec prisma migrate dev --create-only     # then append prisma/sql/constraints.sql to the new migration.sql
pnpm exec prisma migrate dev
```

## Conversation DTO view

`ConversationDto` is a denormalized join; see the `CREATE VIEW conversation_dto`
example at the bottom of `prisma/schema.prisma` (MySQL has no materialized views).
