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

# 2. a staff account to sign in with (the first admin; more are created under /api/v1/admin/users)
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='a long password' pnpm --filter @chat-dashboard/backend user:create-admin

# 3. frontend: shows a sign-in screen, then the dashboard
cd frontend
VITE_WS_URL=ws://localhost:4000/ws pnpm dev

# or skip sign-in with a fixed development token (backend AUTH_MODE=dev only)
VITE_WS_URL=ws://localhost:4000/ws VITE_AUTH_TOKEN=dev:00000000-0000-4000-8000-000000000003:AGENT pnpm dev
```

| Variable          | Meaning                                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_WS_URL`     | gateway URL. Setting it switches to the backend mode.                                                                             |
| `VITE_API_URL`    | REST base URL. Default: the WebSocket URL's host with `/api/v1/admin` (`ws://h:4000/ws` → `http://h:4000/api/v1/admin`).          |
| `VITE_AUTH_TOKEN` | fixed development access token; skips the sign-in screen. Without it, staff sign in with email and password (`docs/api-auth.md`). |

### Sign-in and tokens

- **`shared/api/auth`** owns the session: `signIn` (`POST /auth/login`), `signOut` (`POST /auth/logout`, then forgotten
  locally), and `refreshSession` (`POST /auth/refresh`). The session (access + refresh token and the user) is kept in
  `localStorage["auth.session"]`; `getAuthToken()` reads its access token, so REST, uploads and the WebSocket use it.
- **Refresh rotates and reuse ends the sign-in**, so only one refresh runs at a time: per tab, and across tabs with the
  Web Locks API (a tab that finds the token already rotated by another adopts it). `startSessionKeeper` (started in
  `App`) refreshes a minute before the access token expires and again when the tab becomes visible, and follows
  sign-in/out in other tabs through the `storage` event.
- REST refreshes ahead of expiry and retries a `401` once after a refresh; a WebSocket closed with `4401` triggers a
  refresh so the next reconnect uses the new token. A refused refresh (session revoked, account disabled, role changed)
  signs out; the app then reloads to the sign-in screen, so nothing of the previous user's inbox stays in memory.
- The UI: `pages/login` (`features/auth` `SignInForm`) is shown instead of the dashboard until someone is signed in, and
  realtime starts only after sign-in. The avatar in the top bar (`ProfileMenu`) shows the account and **Sign out**.
- Mock mode and `VITE_AUTH_TOKEN` skip all of this. The refresh token sits in `localStorage`, readable by any script on
  the page: keep the dashboard free of third-party scripts and served with a strict CSP.

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
| `notification.new`                                                 | `notification`                   | added to the bell list and badge, toast, plus a desktop notification in the background   |
| `notification.read`                                                | `notification.read`              | another window read one (or all): the bell marks them read and takes the server's count  |
| `error`                                                            | `notice`                         | toast                                                                                    |
| `presence.updated`                                                 | —                                | no UI yet                                                                                |

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
- **Forward has no valid target in practice.** The server forwards only into an open conversation the agent owns of the
  same customer, or into an `INTERNAL` one; a customer now has at most one open conversation and nothing creates internal
  ones, so the menu shows "Forward (no other chat)". Needs a product decision (see `api-message-actions.md`).
- Mentions: the note form offers the agents named on loaded conversations, but the server refuses anyone who cannot see
  the conversation ("Some mentioned agents cannot see this conversation"), so for an agent most choices fail.
- Sending is not disabled for conversations the agent does not own; the server refuses and the message is marked failed
  with the reason. `permissions` flags from the REST detail could drive the composer later.

## Verifying against the backend

`frontend/src/__e2e__/live-backend.test.ts` drives the frontend's real stack (BackendSocket, WsClient, `startRealtime`,
stores, feature actions) against a running backend: inbox mapping, takeover, optimistic send and ack, history paging,
failed sends, unread, transfer-away, claim races, archive/restore, notifications and reconnect catch-up.
`frontend/src/__e2e__/live-features.test.ts` does the same for FR-14 to FR-27 through the feature actions the screens
call: reply/edit/react/delete (and their realtime echoes), file and voice uploads, the files panel, notes and mentions,
escalation, tags and priority, saved replies, chat settings, callbacks, call control, spam reports and blocking, tabs and
drafts. Both are skipped unless configured, and run one file at a time when `LIVE_API_URL` is set (`vite.config.ts`):

```bash
# backend on a THROWAWAY database (EVENT_BUS=memory is enough for one instance). The tests use dev tokens and expect
# the dev directory's "Agent <id>" names, so AUTH_MODE and BACKEND1_MODE must be dev even if your .env says otherwise.
DATABASE_URL=postgresql://…/chat_test REDIS_URL=redis://127.0.0.1:6379 EVENT_BUS=memory AUTH_MODE=dev BACKEND1_MODE=dev PORT=4555 pnpm dev:backend

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

### Moderation (FR-27)

The chat menu gains "Report spam or abuse" and "Block customer" (`features/moderate-conversation`). Against the real backend
the message settings dialog's blocked-customers and keywords lists are team-wide and held by the server
(`features/message-settings/model/moderation.ts`); with the mock transport they stay local. Details and limits:
[api-moderation.md](api-moderation.md).

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

### Automatic replies and AI training examples

Against the real backend the "Auto-response settings" and "AI training data" pages read and write the team's data
(`features/message-settings/model/automation.ts`, `shared/api/rest/automation.ts`); only supervisors and admins can save
the replies or approve an example, and agents see them read-only. With the mock transport they stay in the browser.
Details: [api-automation.md](api-automation.md).

## Embedded in LOS Web (iframe)

With `VITE_LOS_WEB_ORIGIN` set (Dev: `https://los-dev.delightech.asia`; Staging LOS Web is `https://cms-uat.delightech.asia`)
and the app running inside an iframe, it signs in with a hand-off token from LOS Web instead of showing the sign-in form
(`shared/api/auth/embed.ts`). The message protocol is **PROPOSED**: LOS has not defined one, so agree it with the LOS Web team.

| Direction        | Message                                                             |
| ---------------- | ------------------------------------------------------------------- |
| iframe → LOS Web | `{ type: "TOKEN_REQUEST" }`, posted to the exact LOS Web origin     |
| LOS Web → iframe | `{ type: "HANDOFF_TOKEN", token }`, posted to the exact Chat origin |

The iframe accepts a message only when `event.origin` equals the configured origin and `event.source` is `window.parent`;
it never uses `*`, never reads a token from the URL and never stores the hand-off token. It sends the token to
`POST /api/v1/admin/auth/los` and uses the session the backend issues. That session ends after
`LOS_STAFF_SESSION_SECONDS`; the app then reloads and asks LOS Web for a fresh token (which LOS refuses for suspended
staff). Until LOS issues hand-off tokens for chat (`aud` `chat`, `tokenType` `chat-handoff`, `jti`), this sign-in is refused.
Set the matching `LOS_WEB_ORIGIN` and `CHAT_WEB_ORIGIN` on the backend, and send LOS the Chat dashboard origin so LOS Web
can target it exactly.
