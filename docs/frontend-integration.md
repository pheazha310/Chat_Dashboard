# Frontend ↔ backend integration

The frontend runs in one of two modes, chosen by environment variables. Everything above the socket (stores, widgets,
features) is the same in both, so the mock demo keeps working.

| Mode               | When                | Data comes from                     |
| ------------------ | ------------------- | ----------------------------------- |
| **Mock** (default) | `VITE_WS_URL` unset | the in-browser `MockLendingServer`  |
| **Backend**        | `VITE_WS_URL` set   | the chat backend (WebSocket + REST) |

## Running against the backend

```bash
# 1. backend (needs PostgreSQL with the migration applied, and Redis; see backend/.env.example)
pnpm dev:backend                      # http://localhost:4000, ws://localhost:4000/ws

# 2. frontend: a Backend 1 token is required; until its contract is known, dev tokens are `dev:<userId>:<ROLE>`
cd frontend
VITE_WS_URL=ws://localhost:4000/ws VITE_AUTH_TOKEN=dev:3:AGENT pnpm dev
```

| Variable          | Meaning                                                                                                                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_WS_URL`     | gateway URL. Setting it switches to the backend mode.                                                                                                                                               |
| `VITE_API_URL`    | REST base URL. Default: the WebSocket URL's host with `/api` (`ws://h:4000/ws` → `http://h:4000/api`).                                                                                              |
| `VITE_AUTH_TOKEN` | development access token. In production the host app stores the Backend 1 token in `localStorage["auth.token"]` after sign-in; the sign-in flow itself belongs to Backend 1 and is not in this app. |

Backend `CORS_ORIGIN` must include the frontend origin (default `http://localhost:5173`); the gateway checks it too.
With no token, or a token the gateway rejects (close code 4401/4403), the socket stops retrying and the app stays
offline (a console warning explains why).

## How it fits together

```
widgets ─ features ─ entities ──► wsClient (WsClient: reconnect, queue, validation, unchanged)
                          │                │
                          │                └─► BackendSocket ── BackendTranslator ◄──► gateway /ws
                          └─► shared/api/rest (apiRequest, getMessages, …) ◄──────────► /api
```

- **`shared/api/ws/backend/backend-socket.ts`** is a `WebSocketLike`, like the mock socket. It sends the `auth` frame,
  reports _open_ only after the gateway accepts the token (so offline-queued messages flush once the connection is
  usable) and records the signed-in user in `shared/api/session`.
- **`shared/api/ws/backend/translator.ts`** converts between the frontend's event vocabulary (`ServerEventMap` /
  `ClientEventMap`) and the gateway's. Every event it produces is also valid for `isServerEvent`.
- **`shared/api/backend/`** has the backend's DTO types and the mappers into the frontend's DTOs.
- **`shared/api/rest/`** is the REST client (bearer token, envelope unwrapping, `ApiError`).
- Entities load what the socket does not carry: `loadHistory` / `loadOlderMessages` / `catchUp` (messages) and
  `loadDetails` / `loadArchived` (conversations). They do nothing in mock mode.

### Events (backend → UI)

| Gateway event                                                      | Becomes (UI event)               | Effect                                                                                   |
| ------------------------------------------------------------------ | -------------------------------- | ---------------------------------------------------------------------------------------- |
| `sync`                                                             | `sync` with `partial: true`      | inbox replaced, missed messages **merged**, `incomplete` conversations are paged         |
| `message.new` / `message.ack`                                      | `message.new` / `message.ack`    | inserted in sequence order; an ack replaces the optimistic message matched by `clientId` |
| `message.status` (batched)                                         | one `message.status` per message | delivered / read ticks                                                                   |
| `message.failed`                                                   | `message.failed`                 | optimistic message → _failed_ (Retry), toast with the server's reason                    |
| `conversation.created/updated/assigned/transferred/status_changed` | `conversation.updated`           | upsert; unread comes from a per-conversation counter (the gateway omits it)              |
| `conversation.hidden`                                              | `conversation.removed`           | removed from the inbox                                                                   |
| `conversation.read`                                                | `conversation.unread`            | authoritative unread count (read or marked unread in another tab)                        |
| `notification.new`                                                 | `notification`                   | toast, plus a desktop notification when the tab is in the background                     |
| `error`                                                            | `notice`                         | toast                                                                                    |
| `presence.updated`, `notification.read`                            | —                                | no UI yet                                                                                |

An update saying _someone else now owns it_ removes the conversation for agents (the backend hides it from them);
supervisors keep seeing it.

### Actions (UI → backend)

| UI action                                            | Mock                    | Backend                                                                                             |
| ---------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------- |
| open a conversation                                  | local                   | `conversation.read` if unread, then REST history + details                                          |
| send / retry                                         | `message.send`          | `message.send` (idempotent on `clientId`)                                                           |
| Assign to me / Take over                             | `conversation.takeover` | `conversation.takeover`; the list updates from the server's answer                                  |
| Mark as unread                                       | local + event           | `conversation.unread` (stored, so other sessions see it)                                            |
| Archive / Restore                                    | local                   | `POST /conversations/:id/archive`, undone locally if refused                                        |
| inbox tabs (All, Mine, Unread, Unassigned, Archived) | local filter            | local filter on the synced inbox (first 100); _Archived_ loads `GET /conversations?filter=archived` |
| Load earlier messages                                | —                       | `GET …/messages?before=`                                                                            |
| Request callback                                     | event                   | not supported by the backend: a notice says so                                                      |

### What the conversation DTO shows

`name` = customer name snapshot (or `Customer <id>`), `avatar` = generated initials, `urgent` = priority HIGH,
`handoff` = none/needs-human/assigned → ai/needs-human/assigned, `assignedAgent` from Backend 1 (name), `archived`.
**Loan data is not in the chat backend** (Backend 1 owns it), so the application block shows the application id and
`—` for product, amount and tenor, with status `Unknown`; nothing is invented. System messages (takeover, transfer,
status change) render as quiet notes in the thread.

## Still mock or not wired

- Top-bar bell and profile are static; notifications are shown as toasts only (the REST list/read endpoints exist).
- Applications workspace table, customer call dialog, shared files / media panel, message-settings dialog (the
  _auto-assign_ switch is inert with the backend: assigning needs the server's decision and would race between agents).
- AI features (draft regeneration, summaries, AI replies) are out of scope.
- No UI yet for resolve / close / reopen, transfer, typing indicators from the composer, presence, notification
  preferences, mute, or server-side search (the endpoints exist; see `docs/api-conversations.md`).
- Sending is not disabled for conversations the agent does not own; the server refuses and the message is marked failed
  with the reason. `permissions` flags from the REST detail could drive the composer later.

## Verifying against the backend

`frontend/src/__e2e__/live-backend.test.ts` drives the frontend's real stack (BackendSocket, WsClient, `startRealtime`,
stores, feature actions) against a running backend: inbox mapping, takeover, optimistic send and ack, history paging,
failed sends, unread, transfer-away, claim races, archive/restore, notifications and reconnect catch-up. It is skipped
unless configured:

```bash
# backend on a THROWAWAY database (EVENT_BUS=memory is enough for one instance)
DATABASE_URL=postgresql://…/chat_test REDIS_URL=redis://127.0.0.1:6379 EVENT_BUS=memory PORT=4555 pnpm dev:backend

cd frontend
VITE_WS_URL=ws://127.0.0.1:4555/ws VITE_AUTH_TOKEN=dev:3:AGENT LIVE_API_URL=http://127.0.0.1:4555/api pnpm test
```

It creates its own conversations (unique application ids) and never deletes anything, so use a disposable database.
