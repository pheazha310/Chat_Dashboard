# Database Schema Design — Chat Dashboard

## Overview

The persistent data model of the **chat backend (Backend 2)**, targeting **PostgreSQL 16+** (Prisma 7).
The diagram source is [database-schema.dbml](database-schema.dbml) (paste it into https://dbdiagram.io/d);
`backend/prisma/schema.prisma` is generated from it.

| File                                 | Purpose                                                                                            |
| ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `docs/database-schema.dbml`          | **Source of truth** for tables, columns, indexes and relations                                     |
| `backend/prisma/schema.prisma`       | Generated from the DBML (Backend 2 tables only); do not edit by hand                               |
| `backend/prisma/sql/constraints.sql` | Value-set CHECKs, consistency rules, partial and expression indexes; append to the first migration |
| `backend/prisma.config.ts`           | Prisma 7 config (schema path, `DATABASE_URL`)                                                      |
| `backend/src/config/database.ts`     | `PrismaClient` with the `pg` driver adapter                                                        |

Tables are snake_case plural (`conversations`, `message_receipts`); in code use the Prisma names
(`prisma.conversation`, `lastMessageAt`).

## Service boundary

Two independent backends, each with its own PostgreSQL database:

- **Backend 1 (main):** users, roles, permissions, customers, agents, loan applications and authentication.
  Its tables appear in the DBML (group `Backend_1_External`) and are mirrored as Prisma models (`User`, `Role`,
  `Permission`, `UserRole`, `RolePermission`, `Customer`, `Agent`, `LoanApplication`) **without `password_hash`**.
  Backend 1 owns the data; chat tables never have a foreign key to these models.
- **Backend 2 (chat, this repo):** everything else in the DBML.

Backend 2 stores Backend 1 records as plain `BIGINT` ids with **no foreign key**. A foreign key cannot span two
databases, so existence and permissions of those ids are checked in the service layer against Backend 1 (contract not
yet known; see `authentication-security`). The id spaces are:

| Column kind                                                                                        | Backend 1 id           |
| -------------------------------------------------------------------------------------------------- | ---------------------- |
| `customer_id`, `*_type = CUSTOMER` with `*_id`                                                     | `customers.id`         |
| `agent_id`, `assigned_agent_id`, `assigned_by`, `created_by`, `*_by`, `*_type = AGENT` with `*_id` | `agents.id`            |
| `application_id`                                                                                   | `loan_applications.id` |
| `team_id`                                                                                          | a Backend 1 team id    |

Every actor is identified by `agents.id` or `customers.id`, never `users.id`, so a given person has one id here.
Names, avatars, roles and loan details are fetched from Backend 1, with one exception: `conversations.customer_name`
and `customer_identifier` are snapshots kept so the inbox can be searched and sorted in SQL.

## Conventions

- **Ids:** every primary key is a `UUID` (`@db.Uuid`, default `gen_random_uuid()`, built in since PostgreSQL 13), and
  so is every column that holds a Backend 1 id (`customer_id`, `agent_id`, `user_id`, `*_by`, ...; still no foreign
  key). Ids are plain strings in Prisma and JSON. Random UUIDs carry no order: sort by a timestamp or
  `sequence_number`, never by `id`. The only `BIGINT` columns are counters: `messages.sequence_number`,
  `conversations.last_sequence_number`, `conversation_reads.last_read_sequence_number` and `attachments.file_size`.
- **No database enums.** Fixed-value columns are `VARCHAR` strings. Allowed values are enforced by CHECK constraints
  in `constraints.sql` (the **proposed** sets are listed below; adding a value means changing that CHECK).
- **Polymorphic actors.** Where either a customer or an agent can act, a `*_type` column is paired with a `*_id` column.
- **Types:** timestamps are `timestamptz`, JSON columns are `jsonb`, and `push_devices.device_token` is `VARCHAR(512)` so its unique index stays small.
- **Foreign keys inside this database:** rows owned by a message, note, call or conversation join table cascade on
  delete; optional references use `SET NULL`; everything else is `RESTRICT`, so audit history cannot be deleted by accident.
  `messages.conversation_id` is `RESTRICT` too: messages are soft-deleted and a conversation holding messages cannot be deleted.
  `reply_to_message_id` and `conversation_reads.last_read_message_id` are composite FKs with `conversation_id`, so they can
  only point at a message in the same conversation.
- **Denormalized fields** (`assigned_agent_id`, `last_message_at`, `last_message_preview`, `last_sequence_number`,
  `messages.status`) are updated in the same transaction as the change that affects them.

## Tables

### Conversation core

| Table                       | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `conversations`             | One chat. `conversation_type` (`CUSTOMER_SUPPORT`/`INTERNAL`), `channel` (`web`/`mobile`), `created_by_type`/`created_by_id`, `status`, `priority`, `conversation_mode` (`AI`/`HUMAN`), `handoff_status` (`NONE`/`NEEDS_HUMAN`/`ASSIGNED`), archive (`is_archived`/`archived_at`), `resolved_at`, `closed_at`. Inbox fields: `last_message_at`, `last_message_preview`, `assigned_agent_id` (current owner; the database refuses to commit if it disagrees with the open OWNER row), `customer_name`/`customer_identifier` (search snapshots). `last_sequence_number` is the per-conversation message counter. `customer_id` is required for support chats and NULL for internal ones. |
| `conversation_participants` | Who is in the chat (`CUSTOMER`/`AGENT`/`ASSISTANT`) with a role (`OWNER`/`VIEWER`/`MEMBER`) and `joined_at`/`left_at`. `participant_id` is NULL exactly for the assistant, which has no Backend 1 id. Membership only; **ownership is authoritative in `conversation_assignments`**.                                                                                                                                                                                                                                                                                                                                                                                                   |
| `conversation_assignments`  | Assignment and transfer history: `agent_id`, `assigned_by`, `assignment_type` (`OWNER`/`VIEWER`), `assignment_action` (`TAKEOVER`/`ASSIGNED`/`TRANSFERRED`/`AUTO_ASSIGNED`), `assigned_at`, `ended_at` and `ended_by` (NULL = current), `note`. One open OWNER per conversation. `conversations.assigned_agent_id` mirrors the open OWNER row.                                                                                                                                                                                                                                                                                                                                         |
| `conversation_activities`   | Timeline and audit: `actor_type`, `actor_id` (NULL = system), `activity_type` (status, priority, tag, archive, escalation changes), `description`, `metadata` (JSON).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### Messaging

| Table                  | Purpose                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `messages`             | `sequence_number` (unique per conversation; ordering and reconnect cursor), `client_id` (unique per conversation; idempotent retries), `sender_type`/`sender_id`, `message_type`, `content`, `metadata` (JSON payload for system messages), `status` (sender-facing summary), `reply_to_message_id`, `forwarded_from_message_id`, `is_edited`/`edited_at`, `deleted_at`/`deleted_by` (soft delete). |
| `message_receipts`     | Per-recipient `delivered_at` / `read_at`; unique `(message_id, recipient_type, recipient_id)`.                                                                                                                                                                                                                                                                                                      |
| `conversation_reads`   | Per-reader position: `last_read_message_id`, `last_read_sequence_number`, `marked_unread`. Unread count = `conversations.last_sequence_number - last_read_sequence_number` (approximate: includes system and own messages), or "has unread" when `marked_unread`.                                                                                                                                   |
| `message_edit_history` | Previous content of each edit.                                                                                                                                                                                                                                                                                                                                                                      |
| `message_reactions`    | One emoji per `(message, user_type, user_id)`.                                                                                                                                                                                                                                                                                                                                                      |

### Attachments, notes, escalations, tags

| Table                       | Purpose                                                                                                                                                                                                                                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `attachments`               | File metadata: `conversation_id` (for the Media & Files panel and access checks; an upload exists before its message), `storage_key` (unique), `file_name`, `mime_type`, `file_size`, `duration_ms` and `waveform` (voice), `checksum_sha256`, `upload_status` (indexed for orphan cleanup), `deleted_at`. |
| `message_attachments`       | Join `(message_id, attachment_id, conversation_id)`; composite foreign keys ensure the message and attachment belong to the same conversation.                                                                                                                                                             |
| `internal_notes`            | Agent-only notes, separate from `messages` so they can never be delivered to a customer: `author_agent_id`, `content`, `deleted_at`.                                                                                                                                                                       |
| `note_mentions`             | `@mentioned` agents per note.                                                                                                                                                                                                                                                                              |
| `conversation_escalations`  | `requested_by`, `reason`, `status`, `resolved_by`, `resolved_at`.                                                                                                                                                                                                                                          |
| `tags`, `conversation_tags` | Tags (unique name, also unique ignoring case) and their links.                                                                                                                                                                                                                                             |

### Notifications, presence, templates, automation, AI

| Table                                 | Purpose                                                                                                                      |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `notifications`                       | Per-recipient notification: `notification_type`, `title`, `body`, optional `conversation_id`/`message_id`, `read_at`.        |
| `notification_preferences`            | One row per agent: new-message, assignment, transfer, mention, sound and browser switches.                                   |
| `conversation_notification_settings`  | Per-agent mute: `is_muted` per `(conversation, agent)`.                                                                      |
| `agent_presence_history`              | Agent status periods. Live presence is in Redis; this is history.                                                            |
| `canned_responses`                    | Templates: `shortcut`, `scope` (`PERSONAL`/`SHARED`/`TEAM`), `team_id` (set exactly when `TEAM`), `created_by`, `is_active`. |
| `automation_rules`, `automation_logs` | Auto-reply rules (`trigger_type`, `conditions`, `response_content`) and their execution log.                                 |

### Callbacks, calls, moderation, mobile and workspace

| Table                                                                                                | Purpose                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `callback_requests`                                                                                  | `scheduled_at`, `assigned_agent_id`, `created_by`, `status`, `notes`, `completion_note`, `reminder_sent_at`, `completed_at`.                                                                                                     |
| `calls`, `call_participants`                                                                         | Call history: `call_type`, `status`, `started_at`, `ended_at`; participants with join/leave times. Media is not stored.                                                                                                          |
| `spam_reports`, `customer_blocks`, `blocked_keywords`, `moderation_activities`                       | Spam reports (optionally of a message), customer blocks (one active per customer), keyword rules (unique ignoring case) and a moderation audit log.                                                                              |
| `push_devices`                                                                                       | FCM/APNs tokens for a `user_id` (external `users.id`, customer or agent): `platform`, `device_token`, `is_active`; unique `(platform, device_token)`.                                                                            |
| `workspace_preferences`, `workspace_open_conversations`, `conversation_drafts`, `user_chat_settings` | Per-agent layout JSON (and tab preferences), restorable open tabs, unsent composer drafts per agent and conversation; per-user chat switches (typing and notification sounds, AI suggestions and summaries, auto-assign opt-in). |

## Value sets (proposed)

The DBML names only some of these in column notes; the rest are proposals, enforced by CHECKs in `constraints.sql`.
Confirm them before the first migration.

| Column                                                                                                                                 | Allowed values                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `conversations.conversation_type`                                                                                                      | `CUSTOMER_SUPPORT`, `INTERNAL`                                                                                                                                                                                                          |
| `conversations.channel`                                                                                                                | `web`, `mobile`                                                                                                                                                                                                                         |
| `conversations.created_by_type`                                                                                                        | `CUSTOMER`, `AGENT` (or NULL = system)                                                                                                                                                                                                  |
| `conversations.status`                                                                                                                 | `OPEN`, `RESOLVED`, `CLOSED`                                                                                                                                                                                                            |
| `conversations.priority`                                                                                                               | `HIGH`, `MEDIUM`, `LOW`                                                                                                                                                                                                                 |
| `conversations.conversation_mode`                                                                                                      | `AI`, `HUMAN`                                                                                                                                                                                                                           |
| `conversations.handoff_status`                                                                                                         | `NONE`, `NEEDS_HUMAN`, `ASSIGNED`                                                                                                                                                                                                       |
| `messages.sender_type`                                                                                                                 | `CUSTOMER`, `AGENT`, `ASSISTANT`, `SYSTEM`                                                                                                                                                                                              |
| `messages.message_type`                                                                                                                | `TEXT`, `IMAGE`, `FILE`, `AUDIO`, `VIDEO`, `VOICE`, `SYSTEM`                                                                                                                                                                            |
| `messages.status`                                                                                                                      | `SENDING`, `SENT`, `DELIVERED`, `READ`, `FAILED`                                                                                                                                                                                        |
| recipient, reader, editor, user, uploaded_by, reported_by, initiated_by, call participant, notification recipient, push owner `*_type` | `CUSTOMER`, `AGENT`                                                                                                                                                                                                                     |
| `conversation_participants.participant_type`                                                                                           | `CUSTOMER`, `AGENT`, `ASSISTANT`                                                                                                                                                                                                        |
| `conversation_participants.participant_role`                                                                                           | `OWNER`, `VIEWER`, `MEMBER`                                                                                                                                                                                                             |
| `conversation_assignments.assignment_type`                                                                                             | `OWNER`, `VIEWER`                                                                                                                                                                                                                       |
| `conversation_assignments.assignment_action`                                                                                           | `TAKEOVER`, `ASSIGNED`, `TRANSFERRED`, `AUTO_ASSIGNED`                                                                                                                                                                                  |
| `conversation_activities.activity_type`                                                                                                | `STATUS_CHANGED`, `PRIORITY_CHANGED`, `ASSIGNED`, `TRANSFERRED`, `UNASSIGNED`, `ESCALATED`, `HANDOFF_REQUESTED`, `HANDOFF_ACCEPTED`, `TAG_ADDED`, `TAG_REMOVED`, `ARCHIVED`, `RESTORED`, `NOTE_ADDED`, `CALL`, `CALLBACK`, `MODERATION` |
| `notifications.notification_type`                                                                                                      | `NEW_MESSAGE`, `NEW_CONVERSATION`, `HANDOFF`, `ASSIGNED`, `TRANSFERRED`, `MENTION`, `CALLBACK`, `CALL`, `SYSTEM`                                                                                                                        |
| `moderation_activities.target_type`                                                                                                    | `CUSTOMER`, `CONVERSATION`, `MESSAGE`, `KEYWORD`, `SPAM_REPORT`                                                                                                                                                                         |
| `attachments.upload_status`                                                                                                            | `PENDING`, `UPLOADED`, `FAILED`                                                                                                                                                                                                         |
| `conversation_escalations.status`                                                                                                      | `PENDING`, `RESOLVED`, `CANCELLED`                                                                                                                                                                                                      |
| `canned_responses.scope`                                                                                                               | `PERSONAL`, `SHARED`, `TEAM`                                                                                                                                                                                                            |
| `callback_requests.status`                                                                                                             | `PENDING`, `COMPLETED`, `CANCELLED`, `MISSED`                                                                                                                                                                                           |
| `calls.call_type`                                                                                                                      | `AUDIO`, `VIDEO`                                                                                                                                                                                                                        |
| `calls.status`                                                                                                                         | `INITIATING`, `RINGING`, `ACTIVE`, `ENDED`, `DECLINED`, `MISSED`, `CANCELLED`, `FAILED`                                                                                                                                                 |
| `spam_reports.status`                                                                                                                  | `PENDING`, `CONFIRMED`, `DISMISSED`                                                                                                                                                                                                     |
| `push_devices.platform`                                                                                                                | `ANDROID`, `IOS`                                                                                                                                                                                                                        |
| `agent_presence_history.status`                                                                                                        | `AVAILABLE`, `BUSY`, `AWAY`, `OFFLINE`                                                                                                                                                                                                  |

## Database-enforced rules

These were run against a scratch PostgreSQL (48 insert/update/delete cases) and behave as listed: valid rows accepted, violations rejected.

| Rule                                                                                                          | Mechanism                                                                      |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `file_size`, `duration_ms`, sequence counters are `>= 0`; `sidebar_width > 0`                                 | CHECK                                                                          |
| Fixed-value columns hold only allowed values                                                                  | CHECK (value sets above)                                                       |
| Support chats have a `customer_id`; internal chats may not                                                    | CHECK                                                                          |
| `handoff_status = ASSIGNED` <=> `assigned_agent_id` set, and requires human mode                              | CHECK                                                                          |
| `is_archived` agrees with `archived_at`                                                                       | CHECK                                                                          |
| `OPEN` has no resolved/closed time; `RESOLVED`/`CLOSED` carry theirs                                          | CHECK                                                                          |
| At most one non-closed conversation per loan application                                                      | partial UNIQUE index                                                           |
| One open OWNER per conversation; one open membership per participant                                          | partial UNIQUE indexes                                                         |
| `conversations.assigned_agent_id` always equals the open OWNER row's agent (checked at COMMIT)                | deferred constraint trigger                                                    |
| One pending escalation per conversation                                                                       | partial UNIQUE index                                                           |
| `is_edited` agrees with `edited_at`; `deleted_by` needs `deleted_at`; a receipt is read after it is delivered | CHECK                                                                          |
| A participant joins a call once                                                                               | UNIQUE `(call_id, participant_type, participant_id)`                           |
| One open presence period per agent                                                                            | partial UNIQUE index                                                           |
| A reply points at a message in the same conversation; message numbers start at 1                              | composite FK + unique index, CHECK                                             |
| A message can only link an attachment from its own conversation                                               | composite foreign keys                                                         |
| The assistant participant has no id; others do; no backwards time ranges                                      | CHECK                                                                          |
| Creator type and id set together                                                                              | CHECK                                                                          |
| One active block per customer                                                                                 | partial UNIQUE index                                                           |
| No duplicate message order or optimistic send                                                                 | UNIQUE `(conversation_id, sequence_number)` and `(conversation_id, client_id)` |
| `SYSTEM` messages have no sender id; `TEXT` messages have content                                             | CHECK                                                                          |
| `TEAM` template <=> `team_id` set                                                                             | CHECK                                                                          |
| `COMPLETED` callback has `completed_at`; call ends after it starts                                            | CHECK                                                                          |
| Tag names and blocked keywords unique ignoring case                                                           | UNIQUE index on `lower(...)`                                                   |

Not enforced by the database (do it in the application): that every Backend 1 id exists, that a `*_type` matches the
role Backend 1 reports for the id, permissions, attachment type and size limits, and retention.

## Workflows

**Customer message:** in one transaction, `UPDATE conversations SET last_sequence_number = last_sequence_number + 1,
last_message_at = now(), last_message_preview = ... WHERE id = ? RETURNING last_sequence_number`, insert the message
with that number, and (if `conversation_mode = AI`) queue the AI reply. The row lock serializes concurrent senders, so
there are no gaps from races. If the AI escalates, set `handoff_status = NEEDS_HUMAN`, insert a
`conversation_activities` row, and notify agents.

**Takeover / assign (race-safe):** in one transaction (a deferred trigger checks at COMMIT that the conversation pointer and the open OWNER row agree, so write both before committing), update the conversation only if `handoff_status =
'NEEDS_HUMAN'` (0 rows = someone else won) setting `conversation_mode = 'HUMAN'`, `handoff_status = 'ASSIGNED'` and
`assigned_agent_id`; end any open `OWNER` assignment (`ended_at`, `ended_by`); insert the new `conversation_assignments`
row (the partial unique index is the backstop); write an activity.

**Agent message:** validate the caller holds the open `OWNER` assignment, insert (idempotent on `client_id`), return
the ack mapping `client_id` to the new id, then record receipts as recipients acknowledge and update
`messages.status`.

**Unread:** `conversations.last_sequence_number - conversation_reads.last_read_sequence_number` for that reader.

**Inbox filters:** Mine = `assigned_agent_id`; Unassigned = `handoff_status = 'NEEDS_HUMAN'` (served by a partial index on the queue); Archived =
`is_archived`; name search = prefix match on `lower(customer_name)`.

## Open decisions

- **Protocol id.** The WebSocket protocol identifies a conversation by `slug` (for example `maya`); there is no `slug`
  column. Either add one or change the protocol to use the conversation UUID.
- **Value sets** above are proposals; confirm them.
- **Archive** is global (one flag per conversation), not per agent.
- **Retention** (FR-10) needs a scheduled job; no schema support beyond soft delete.
- **Snapshot refresh.** `customer_name` / `customer_identifier` go stale if Backend 1 changes them; decide how Backend 1
  notifies this service.

## Setup

```bash
pnpm install
cp backend/.env.example backend/.env
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/chat?schema=public"
pnpm db:generate                              # client -> backend/prisma/generated/prisma
pnpm db:migrate --create-only     # then append backend/prisma/sql/constraints.sql to the new migration.sql
pnpm db:migrate
```

## Conversation DTO

`ConversationDto` is composed in the service layer: conversation rows from this database (inbox fields, handoff,
priority, tags, activities) plus customer avatar/profile and loan application details fetched from Backend 1 by
`customer_id` / `application_id`. There is no SQL view, because that data is not in this database.
