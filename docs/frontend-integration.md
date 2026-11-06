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

# 2. frontend: a Backend 1 token is required; until its contract is known, dev tokens are `dev:<userUuid>:<ROLE>`
cd frontend
VITE_WS_URL=ws://localhost:4000/ws VITE_AUTH_TOKEN=dev:00000000-0000-4000-8000-000000000003:AGENT pnpm dev
```

| Variable          | Meaning                                                                                                                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_WS_URL`     | gateway URL. Setting it switches to the backend mode.                                                                                                                                               |
| `VITE_API_URL`    | REST base URL. Default: the WebSocket URL's host with `/api/v1/admin` (`ws://h:4000/ws` → `http://h:4000/api/v1/admin`).                                                                            |
| `VITE_AUTH_TOKEN` | development access token. In production the host app stores the Backend 1 token in `localStorage["auth.token"]` after sign-in; the sign-in flow itself belongs to Backend 1 and is not in this app. |

Backend `CORS_ORIGIN` must include the frontend origin (default `http://localhost:5173`); the gateway checks it too.
With no token, or a token the gateway rejects (close code 4401/4403), the socket stops retrying and the app stays
offline (a console warning explains why).

## How it fits together

```
widgets ─ features ─ entities ──► wsClient (WsClient: reconnect, queue, validation, unchanged)
                          │                │
                          │                └─► BackendSocket ── BackendTranslator ◄──► gateway /ws
                          └─► shared/api/rest (apiRequest, getMessages, …) ◄──────────► /api/v1/admin
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
| Request callback                                     | event                   | replaced by REST: "Callbacks" panel (`api-callbacks.md`); the old hidden button still gets a notice |

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
VITE_WS_URL=ws://127.0.0.1:4555/ws VITE_AUTH_TOKEN=dev:00000000-0000-4000-8000-000000000003:AGENT LIVE_API_URL=http://127.0.0.1:4555/api/v1/admin pnpm test
```

It creates its own conversations (unique application ids) and never deletes anything, so use a disposable database.

## Workspace: tabs and drafts (FR-14, FR-15)

Only with the real backend (`VITE_WS_URL` set); the mock server has no REST, so tabs and drafts stay in memory there.

- `features/chat-tabs` keeps the open tabs (`openTab`, `closeTab`) and renders the strip when two or more are open.
  The selected conversation always gets a tab. Closing a tab calls `DELETE /workspace/tabs/:id` and never touches the
  conversation.
- `features/send-message` saves the draft 800 ms after typing stops (`PUT /workspace/drafts/:id`) and discards it on
  send. Drafts are per conversation; a remote draft older than the last local edit is ignored.
- `app/providers/realtime.ts` calls `GET /workspace` after the first `sync` to restore tabs and drafts, and routes
  `workspace.tab_opened`, `.tab_closed` and `.draft_updated` from the agent's other windows into those stores.
- `PATCH /workspace/preferences` (`restoreTabs`, `persistTabs`) has a REST client (`shared/api/rest/workspace.ts`) but
  no settings UI yet.

### Calls (FR-26)

Against the real backend the call button starts a real WebRTC call (`features/customer-call/model/live-call.ts`): REST for
control, the WebSocket for `call.offer`/`call.answer`/`call.ice_candidate`, ICE servers from `GET /calls/config`. With the
mock transport the old preview dialog stays. Details and limits (no customer channel yet, audio only):
[api-calls.md](api-calls.md).

### Callbacks (FR-25)

`features/request-callback` adds a "Callbacks" panel (schedule, mark done, cancel) opened from the chat's more menu, using
`shared/api/rest/callbacks.ts`. Reminders arrive as notifications. Details: [api-callbacks.md](api-callbacks.md).

### Chat settings (FR-24)

`features/message-settings` syncs typing sound, auto-assign and the two AI switches with `GET|PATCH /agents/me/chat-settings`
(`shared/api/rest/chat-settings.ts`); a failed save puts the switch back. `app/providers/realtime.ts` loads the values
after the first `sync` and applies `chat_settings.updated` from the agent's other windows. "New conversation alerts"
stays browser-local. Details: [api-chat-settings.md](api-chat-settings.md).
