# Implementation report: chat backend and frontend integration

Status as of 2026-11-05, branch `feature/wed-api`. Nothing in this change is committed.

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
4. **Auto-assign setting is inert** with the real backend.
5. **Loan fields** in the customer panel show "—"/"Unknown".
6. **Attachments and storage** are not implemented; no storage decision has been made.
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
