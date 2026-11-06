# Implementation report: chat backend and frontend integration

Status as of 2026-11-06, branch `feature/wed-api`. Sections 1 to 7 describe the first delivery (FR-01 to FR-13); section 8 covers
the enhanced and advanced chat features (FR-14 to FR-27) and the final hand-off.

Scope: the chat backend ("Backend 2") for the loan-support dashboard and its integration with the existing frontend.
Users, authentication, customers and loan data belong to Backend 1 (external) and are consumed, not duplicated.
There are no AI features.

## 1. What was built

| Area                        | Result                                                                                                                                                                                                                                          |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conversations and workspace | List with filters and search, create, detail with permissions, status change, archive/restore, activity log, customers' other conversations, participants ([api-conversations.md](api-conversations.md))                                        |
| Assignment                  | Takeover, assign, transfer, unassign, assignment history; races resolved by row lock                                                                                                                                                            |
| Messages                    | Idempotent send (`clientId`), cursor history, delivered/read receipts, mark read/unread, per-conversation sequence numbers                                                                                                                      |
| Notifications               | List, unread count, mark read, read-all, preferences, per-conversation mute                                                                                                                                                                     |
| Presence and typing         | Live presence in Redis, history in PostgreSQL, typing with TTL                                                                                                                                                                                  |
| Customer info               | Read through the Backend 1 `Directory` port, redacted by role                                                                                                                                                                                   |
| Realtime gateway            | `/ws`, first-frame `auth`, per-socket audience filtering, `conversation.hidden`, reconnect sync with cursors, Redis or in-memory event bus ([websocket-events.md](websocket-events.md))                                                         |
| OpenAPI                     | Generated from the zod schemas, one `.openapi.ts` per module                                                                                                                                                                                    |
| Frontend integration        | `BackendSocket` and `BackendTranslator` behind the unchanged `WsClient`, REST client, unread counters, reconnect catch-up. The mock server remains the default when `VITE_WS_URL` is unset ([frontend-integration.md](frontend-integration.md)) |

Layering follows `routes → controller → service → repository → Prisma` in every module. Services never see
`req`/`res`; only repositories use Prisma. REST and WebSocket share the services built once in `container.ts`.

## 2. Requirement coverage

| FR    | Topic                    | Status  | Notes                                                                                            |
| ----- | ------------------------ | ------- | ------------------------------------------------------------------------------------------------ |
| FR-01 | Inbox                    | Done    | Filters, pagination, newest activity first                                                       |
| FR-02 | Conversation management  | Done    | Backend complete. **No UI** for resolve/close/reopen                                             |
| FR-03 | Realtime messaging       | Done    | Idempotent, ordered by sequence number                                                           |
| FR-04 | Delivery and read status | Done    |                                                                                                  |
| FR-05 | Unread                   | Done    | Mark unread supported                                                                            |
| FR-06 | Typing and presence      | Done    | Backend and protocol complete. **No UI** for typing or presence                                  |
| FR-07 | Search and filters       | Done    | Server-side `q`. The UI still filters locally                                                    |
| FR-08 | Assignment and transfer  | Done    | Backend complete. **No transfer dialog** in the UI                                               |
| FR-09 | Workspace APIs           | Done    |                                                                                                  |
| FR-10 | History and sync         | Done    | Cursor history; reconnect sync reports `incomplete` when a gap is too large to replay            |
| FR-11 | Customer info            | Partial | Loan fields are placeholders until the Backend 1 contract exists                                 |
| FR-12 | Notifications            | Partial | Backend complete. The bell and profile in the header are still static                            |
| FR-13 | Permissions              | Done    | One policy (`shared/policy/conversation-access.ts`) used by REST and WS; hidden chats return 404 |

## 3. Verification

Run on 2026-11-05 against a throwaway PostgreSQL 18 and Redis (not the `.env` database; the test guard refuses any
database whose name does not contain "test").

| Check                                                | Result                                                                                                     |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `pnpm check` (typecheck, lint, FSD, format, tests)   | Pass. Frontend 200 passed, 11 skipped. Backend 141 passed, 72 skipped (integration needs the throwaway DB) |
| Backend suite with integration tests enabled         | **213 / 213 passed**                                                                                       |
| Backend coverage                                     | Statements 95.2%, branches 92.5%, functions 95.2%, lines 96.1% (thresholds 70/70/70/65)                    |
| Frontend live E2E against a running backend          | **11 / 11 passed**, three consecutive runs                                                                 |
| Database invariants (51 conversations, 337 messages) | All clean, listed below                                                                                    |

Database invariants checked, each with zero violations: `last_sequence_number` equals the message count; no sequence
gaps or duplicates; `ASSIGNED` exactly when an owner is set; the owner matches the single open `OWNER` assignment;
at most one open owner per conversation; no duplicate `(conversation_id, client_id)`; no read position beyond the last
sequence; `last_message_preview` matches the latest non-system message; no orphan receipts.

One finding during the live run: the E2E test asserted the "transferred away from you" notification at the same
instant the conversation left the inbox, but the notification is a separate event and can land slightly later. The
product behaviour is correct (the notification was stored and delivered); the test now waits for it.

## 4. Not verified

- **No browser run.** The new CSS and the changed widgets (ChatWindow, ExpandedChat, ConversationSidebar,
  CustomerContext) are covered by store and E2E tests but have not been looked at.
- Behaviour with several API instances is covered by the event-bus design and tests, not by a multi-process run.
- Node 24 was used locally; the repo pins Node 22.

## 5. Known gaps

1. **Authentication is a stub.** `DevAuthClient` accepts `dev:<userUuid>:<ROLE>` tokens and is refused in production.
   The external mode throws "not implemented" because the Backend 1 contract (token verification, claims, user
   directory) has not been provided. Token expiry mid-connection is therefore not enforced.
2. **Customer channel and AI worker are designed, not built.** `MessageService.receiveFromCustomer` exists and is
   tested, but nothing calls it yet.
3. **Missing UI:** transfer dialog, resolve/close/reopen, notification dropdown on the bell, mute toggle, typing and
   presence indicators, preferences, server-side search box. The composer is not disabled for non-owners (the server
   rejects the send with 403).
4. **Auto-assign setting** is now saved per agent (FR-24) but nothing assigns automatically yet, so it still has no effect.
5. **Loan fields** in the customer panel show "—"/"Unknown".
6. ~~Attachments and storage are not implemented~~ Done in the FR-17/18 work (section 8): local-disk storage behind a `Storage` port; the production storage decision is still open.
7. **Swagger UI** is not served; the OpenAPI document is generated but not exposed through a UI. Decision pending.

## 6. Decisions needed from the team

- The Backend 1 contract: token format and verification, role claims, user and customer directory endpoints.
- Attachment storage (provider, size limits, scanning).
- Whether to serve Swagger UI, and in which environments.
- Whether to build the missing UI (section 5, item 3) before the first release.

## 7. Running the verification yourself

```bash
# Static checks
pnpm check

# Backend integration tests (throwaway database whose name contains "test", and a throwaway Redis: it is flushed)
TEST_DATABASE_URL=postgresql://USER@HOST:PORT/chat_test TEST_REDIS_URL=redis://HOST:PORT pnpm --filter @chat-dashboard/backend test:coverage

# Frontend against a running backend (see frontend-integration.md, "Verifying against the backend")
VITE_WS_URL=ws://127.0.0.1:4555/ws VITE_AUTH_TOKEN=dev:00000000-0000-4000-8000-000000000003:AGENT LIVE_API_URL=http://127.0.0.1:4555/api \
  pnpm --filter @chat-dashboard/frontend test
```

## 8. Enhanced and advanced chat (FR-14 to FR-27) and hand-off

Delivered in twelve phases, each finished (code, tests, docs) before the next. FR-22 and FR-23 were not part of this brief.

| FR        | Feature                                  | Status  | Guide                                                | What to know                                                                                                                      |
| --------- | ---------------------------------------- | ------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| FR-14, 15 | Conversation tabs and windows            | Done    | [api-workspace.md](api-workspace.md)                 | Tabs, drafts and preferences per agent, synced across their windows. Closing a tab never touches the conversation                 |
| FR-16     | Reply, edit, delete, react, forward      | Done    | [api-message-actions.md](api-message-actions.md)     | Edit history kept; soft delete                                                                                                    |
| FR-17, 18 | Files, images, documents, voice messages | Done    | [api-attachments.md](api-attachments.md)             | Allow-listed types with magic-byte checks, authorised downloads with ranges. Local-disk storage                                   |
| FR-19     | Internal notes, mentions, escalation     | Done    | [api-notes-escalations.md](api-notes-escalations.md) | Notes live in their own table and can never reach a customer. No persistent supervisor notification (needs Backend 1)             |
| FR-20     | Tags and priority                        | Done    | [api-tags-priority.md](api-tags-priority.md)         | Filtering and sorting in the inbox                                                                                                |
| FR-21     | Canned responses                         | Done    | [api-canned-responses.md](api-canned-responses.md)   | Personal and shared. The TEAM scope is switched off until Backend 1 can say who is on a team                                      |
| FR-24     | Chat settings                            | Done    | [api-chat-settings.md](api-chat-settings.md)         | AI and auto-assign switches are stored only; nothing reads them yet                                                               |
| FR-25     | Callbacks                                | Done    | [api-callbacks.md](api-callbacks.md)                 | Reminder and missed-callback job, safe on several instances                                                                       |
| FR-26     | Calls (WebRTC signalling only)           | Partial | [api-calls.md](api-calls.md)                         | Agent side complete. The customer side exists as service methods; **no real call can complete until the customer channel exists** |
| FR-27     | Spam and moderation                      | Partial | [api-moderation.md](api-moderation.md)               | Enforcement is in the customer entry points, which nothing calls yet. Keywords flag, they do not reject                           |

The map of modules and ports is in [backend-structure.md](backend-structure.md); every WebSocket event, with sender, target,
payload, authorisation, server logic, acknowledgment and error handling, is in [websocket-events.md](websocket-events.md) and
the per-feature guides. The Postman collection has a folder per feature.

### Verification

Run on 2026-11-06 against a throwaway PostgreSQL and Redis (the test guard refuses any database whose name lacks "test").

| Check                                                              | Result                                                                                                                       |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check` (typecheck, lint, FSD, format, tests)                 | Pass: 575 backend tests, 300 frontend tests (11 more run only against a live backend)                                        |
| Backend suite with integration tests, with coverage                | 575 / 575 passed. Statements 93.6%, branches 92.4%, functions 93.4%, lines 94.4% (thresholds 70/70/70/65)                    |
| Cross-feature end-to-end (`src/__tests__/e2e.integration.test.ts`) | Passes three times in a row: HTTP + WebSocket + Redis bus + PostgreSQL, one scripted working day, three watchers             |
| Frontend live E2E against a running backend                        | **11 / 11**, three consecutive runs                                                                                          |
| Docs-consistency test                                              | Routes in Postman, events in `websocket-events.md`, env variables in `.env.example` and docs, guides linked from `AGENTS.md` |
| Database invariants (62 conversations, 410 messages)               | All clean: sequences, ownership, one open call, one active block, callback timestamps, no note text in messages              |

What the end-to-end test proves: the other agent (who is not on the conversation) received **none** of 20 sensitive event types
and never the text of a note or a spam report; the supervisor received what supervisors should and none of the agent-only
events (callback reminders, call answers, drafts, settings); the owner's second window received the workspace and settings events.
Breaking the gateway's audience filter, or sending a reminder to the wrong audience, failed it.

Deliberate breakages ("mutation checks") were run for the rules that matter, and each made a test fail: duplicate reactions,
mention visibility, priority order, personal-template privacy, the callback and call row claims (`SKIP LOCKED`), the call
role checks, the browser's buffering of early offers and candidates, the blocked-customer check, the unblock rule, the keyword
flag, the audience filter. Tests that passed under a breakage were rewritten until they failed (the job-claim tests were).

Findings along the way: Prisma's `contains` does not escape `%` and `_` (fixed for new code; the old conversation search
`q` still has it, which only widens results); the pre-existing live E2E test had been stale since the UUID migration (agent
names are `Agent <uuid>`) and was corrected; the docs-consistency test found `notification.read` was never documented.

### Not verified

- **No browser run** of any new screen (tabs strip, notes panel, organize panel, saved replies, callbacks panel, call
  dialog, moderation lists). They are covered by store and function tests and by the live E2E, not looked at.
- **No real call between two browsers.** Impossible today (no customer channel); the WebRTC code is tested with a fake peer.
- **No multi-instance run.** The job claims and the event bus are tested for races, not with several processes.
- **No load test.** Nothing was measured under volume (the inbox query, the keyword scan, signalling frame rates).
- **Antivirus scanning of uploads** is not done (size, type and magic-byte checks only).

### Open decisions for the team

1. **The customer channel** (its authentication, `/api/v1/customer`): needed before calls and moderation enforcement work for real.
2. **Backend 1's contract**: roles (to mention or assign a supervisor), teams (to switch on TEAM templates), who may be auto-assigned.
3. **Production file storage**: provider, retention, scanning. Only the local-disk driver exists.
4. **STUN/TURN servers** for calls across networks (`CALL_*` variables); none are configured by default on purpose.
5. **Moderation rules**: who may block, review and manage keywords (assumed: owner/supervisor, supervisors, supervisors), and
   whether a keyword match should flag (built) or reject.
6. **Missing UI** that the APIs already support: spam report queue and log, callback list and rescheduling, tag management,
   reactivating canned responses, per-message report and typed-shortcut expansion.

### Before you merge or deploy: things only you can do

- **Apply the migrations to a database at the current base schema.** Four were added after the base schema and have only
  been applied to a throwaway database: `20261106000000_conversation_drafts`, `20261107000000_canned_response_shared_scope`,
  `20261108000000_calls_one_open_per_conversation`, `20261109000000_spam_reports_one_pending`.
  **A dev database created before the UUID migration (`c5ecad8`) cannot take them.** The base migration was edited in place
  after that database was created (integer ids became UUIDs; the AI tables were removed), so `pnpm db:migrate` reports drift
  and asks for a reset (seen on a database named `chat`). Use a fresh database and `prisma migrate deploy`, or
  `prisma migrate reset` if its data is disposable. Converting the old integer ids is not supported.
- **Copy the new variables** from `backend/.env.example` into your real `.env` (`STORAGE_*`, `MAX_UPLOAD_BYTES`, `CALLBACK_*`,
  `CALL_*`). Set `CALL_TURN_SECRET` there, never in the repo.
- **Production storage**: `STORAGE_DIR` must be a persistent disk shared by every API instance, or the driver must be replaced.
- **Throwaway services I started** for testing (a database named `chat_dashboard_claude_test` and a Redis on port 6390) are
  still running and can be removed.
