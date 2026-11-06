# Chat settings API (FR-24)

Each agent's own chat switches: typing sound, notification sound, AI suggestions, AI summaries and the opt-in to
automatic assignment. Routes are under `/api/v1/admin/agents/me` and need a dashboard bearer token (customers get 403).
Interactive reference: `GET /api/v1/admin/openapi.json`. Envelope: `{ "status": "success", "data": ... }`.

## Scope and permissions

There is no agent id in the path: `me` is always the caller (from the token). No call can read or change another
agent's settings, and a body naming one (`userId`, `agentId`, ...) is rejected with `400` as an unknown key. So there is
no permission rule beyond being a signed-in dashboard user. The data lives in `user_chat_settings` (one row per agent,
unique on `user_id`); no migration was needed.

## Endpoints

| Method and path                  | Body                                    | Notes                                                                             |
| -------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------- |
| `GET /agents/me/chat-settings`   |                                         | Saved values, or the defaults when nothing was saved. Reading never creates a row |
| `PATCH /agents/me/chat-settings` | any of the five booleans (at least one) | Partial update. Returns all five. Unknown keys and non-booleans give `400`        |

```json
{
  "typingSoundEnabled": true,
  "notificationSoundEnabled": true,
  "aiSuggestionsEnabled": true,
  "aiSummariesEnabled": true,
  "autoAssignEnabled": false
}
```

Defaults (the table's column defaults): everything on except `autoAssignEnabled`, which is **off** until the agent opts in.

- The first save creates the row and later ones change only the given columns, in one `INSERT … ON CONFLICT` statement.
  Two windows saving at once therefore never fail on the unique key and never undo each other's different switches
  (tested with four simultaneous first saves: one row, all four changes kept).
- Sending only values the agent already has changes and broadcasts nothing.

## What the switches do today

| Switch                                       | Effect today                                                                                                   |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `typingSoundEnabled`                         | The dashboard plays its typing sound only when on.                                                             |
| `aiSuggestionsEnabled`, `aiSummariesEnabled` | **Stored only.** The AI assistant is not built, so the backend does not read them.                             |
| `autoAssignEnabled`                          | **Stored only.** Nothing assigns automatically yet. See below.                                                 |
| `notificationSoundEnabled`                   | Stored and returned. The dashboard has no control for it yet; it is not the same as "new conversation alerts". |

`autoAssignEnabled` is the agent's own **opt-in**, not a grant. The brief says it applies "only when authorized", and who
is authorized is Backend 1's knowledge (roles and permissions), whose contract is not known. Whatever assigns
conversations automatically in the future must check the agent's role itself and must not treat this flag as
permission.

Notification kinds (new message, assignment, transfer, mention) are a different table, `notification_preferences`,
already used by the notification service, and are not part of this API.

## WebSocket event (server to client)

| Item           | Value                                                                                                                         |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Name           | `chat_settings.updated`                                                                                                       |
| Sender, target | The server, to **all sessions of the same agent** only (audience `users: [agent]`). Nobody else receives it.                  |
| Payload        | `{ settings: { typingSoundEnabled, notificationSoundEnabled, aiSuggestionsEnabled, aiSummariesEnabled, autoAssignEnabled } }` |
| Authentication | The `/ws` first-frame token.                                                                                                  |
| Authorization  | Delivered by user id, so another agent's sockets cannot receive it.                                                           |
| Server logic   | After a `PATCH` that changed something, with the full saved settings.                                                         |
| Acknowledgment | None (not client-sent).                                                                                                       |
| Error handling | A failed publish is logged and never fails the REST call; the other window picks the values up on its next load.              |

## Frontend

`features/message-settings` (the message settings dialog) keeps its local store and now syncs four of its switches:

| Dialog switch         | Backend field          |
| --------------------- | ---------------------- |
| Typing sound          | `typingSoundEnabled`   |
| Auto-assign new chats | `autoAssignEnabled`    |
| AI reply suggestions  | `aiSuggestionsEnabled` |
| AI summary notes      | `aiSummariesEnabled`   |

- A toggle changes the screen at once and saves with `PATCH`. If the server refuses, the switch goes back and a toast
  says so. Only the newest save of a switch may undo it, so a late failure of an older click never overrides a later one.
- `app/providers/realtime.ts` calls `GET /agents/me/chat-settings` after the first `sync` and applies
  `chat_settings.updated` from the agent's other windows. This runs only against the real backend; with the mock
  transport the dialog stays browser-local as before.
- "New conversation alerts" has no backend counterpart and stays in this browser only. The response templates, training
  examples and the blocked customers/keywords lists in the same dialog are untouched (blocking is FR-27, a later phase).
- Because the backend is now the source of truth, **auto-assign shows as off** for an agent who never saved it (the
  dialog's old local default was on).

## Tests

Unit tests cover the schema (empty, non-boolean and unknown keys), defaults without a row, caller-only access, the
no-change case, and a failing publish. `chat-settings-api.integration.test.ts` runs the real app over HTTP against
PostgreSQL: defaults, partial saves, separate agents, unknown keys such as `userId`, four simultaneous first saves,
validation, and authentication (401 anonymous, 403 customer). Frontend tests cover the switch-to-field mapping,
reverting on failure (including that an older failure cannot undo a newer choice) and applying remote values.
