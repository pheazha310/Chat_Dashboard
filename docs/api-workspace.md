# Workspace API: multiple tabs and windows (FR-14, FR-15)

Per-agent workspace state: the conversations an agent keeps open as tabs, their unsent drafts and two tab
preferences. All routes are under `/api/v1/admin/workspace`, need a dashboard bearer token (AGENT, SUPERVISOR or
ADMIN) and are **scoped to the caller**: there is no way to read or change another agent's workspace.

**Tabs are UI state, not conversation state.** Closing a tab only deletes the agent's own
`workspace_open_conversations` row. It never closes, resolves, archives, unassigns or marks anything read. Scroll
position, window geometry and composer focus stay in the frontend; the backend creates no records for browser windows.

Response envelope: `{ "status": "success", "data": ... }` (see `api-response-contracts.md`). Interactive reference:
`GET /api/v1/admin/openapi.json`.

## Endpoints

| Method and path                            | Purpose                                                                                                              |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `GET /workspace`                           | Preferences, restorable tabs (with the conversation summary and this agent's unread count) and drafts, in one call.  |
| `PATCH /workspace/preferences`             | Body `{ restoreTabs?: boolean, persistTabs?: boolean }` (at least one). Merged atomically; both default to `true`.   |
| `PUT /workspace/tabs/:conversationId`      | Open a tab. Idempotent (no duplicate tabs). Needs access to the conversation (404 otherwise). Max 20 tabs (409).     |
| `DELETE /workspace/tabs/:conversationId`   | Close a tab. Idempotent; works even if the conversation became hidden.                                               |
| `PUT /workspace/drafts/:conversationId`    | Body `{ content: string }`, max 10000 chars. Replaces my draft. Empty `content` deletes it and returns `data: null`. |
| `DELETE /workspace/drafts/:conversationId` | Discard my draft (call after sending). Idempotent.                                                                   |

### Preference semantics

- `restoreTabs: false`: `GET /workspace` returns `tabs: []` (stored tabs are kept, not deleted).
- `persistTabs: false`: `PUT /tabs/:id` answers `{ persisted: false, sortOrder: null }` and stores nothing;
  `DELETE` still removes anything stored earlier.

### Example

```http
PUT /api/v1/admin/workspace/tabs/6c1f6a52-0d0c-4f5e-9d63-1d2f1a8a7b11
```

```json
{ "status": "success", "data": { "conversationId": "6c1f6a52-…", "persisted": true, "sortOrder": 2 } }
```

```http
GET /api/v1/admin/workspace
```

```json
{
  "status": "success",
  "data": {
    "preferences": { "restoreTabs": true, "persistTabs": true },
    "tabs": [
      {
        "conversationId": "6c1f6a52-…",
        "sortOrder": 0,
        "lastOpenedAt": "2026-11-06T09:00:00.000Z",
        "conversation": {
          "id": "6c1f6a52-…",
          "customerName": "Maya Chen",
          "unreadCount": 3,
          "priority": "MEDIUM",
          "...": "..."
        }
      }
    ],
    "drafts": [{ "conversationId": "6c1f6a52-…", "content": "Dear Maya,", "updatedAt": "2026-11-06T09:01:00.000Z" }]
  }
}
```

### Authorization and errors

| Case                                                         | Result                                                         |
| ------------------------------------------------------------ | -------------------------------------------------------------- |
| No or invalid token / customer role                          | 401 / 403                                                      |
| Opening a tab or saving a draft for a hidden conversation    | 404 (same as REST: hidden looks missing)                       |
| 21st tab                                                     | 409 `CONFLICT`                                                 |
| Invalid UUID, empty preference body, draft > 10000 chars     | 400 with zod issues in `error.details`                         |
| Stored tab/draft whose conversation the agent lost access to | Omitted from `GET /workspace`, not deleted (access can return) |

## Unread counts and cross-tab sync

- `GET /workspace` carries each tab's `unreadCount` (customer messages after the agent's read position, plus a
  manual "mark unread" flag), the same number `GET /conversations` returns.
- Afterwards the existing events keep every window current: `message.new`, `conversation.updated`,
  `conversation.assigned`, `conversation.status_changed`, `conversation.read` (read position, sent to all of the
  agent's sessions) and `notification.new`.
- Drafts are per agent **and** conversation (unique `agent_id, conversation_id`), so two agents never share one.
  Clients should save with a debounce (about 1 s), and discard the draft after a successful send.

## Multiple windows (FR-15)

Each browser window opens its own `/ws` connection and authenticates with its first `auth` frame. The gateway
checks access **per socket** for every event, so a window never receives something its user could not open over REST.
Events addressed to a user (`workspace.*`, `conversation.read`, `notification.*`) reach **all** of that user's windows.
Presence counts an agent as online while at least one window is connected. Nothing about a window is stored.

## WebSocket events

Server → client only; the changes themselves are made over REST. Delivery is best effort: a failed publish is logged
and never fails the REST call (clients re-read `GET /workspace` on reconnect).

Common to all four events: **Sender** server (after the REST write commits). **Target** every open session of the acting
agent, including the one that made the call (apply idempotently). **Authentication** the `/ws` first-frame token.
**Authorization** audience `users: [agentId]`, so no other user receives them. **Acknowledgment** none (not
client-sent). **Error handling** publish failures are logged server-side; the REST caller is unaffected.

| Event                           | Payload                                                  | Server-side logic                                                                                                                                                  |
| ------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `workspace.tab_opened`          | `{ conversationId, sortOrder, lastOpenedAt }`            | After `PUT /tabs/:id` stored or refreshed the tab (not sent when `persistTabs` is off).                                                                            |
| `workspace.tab_closed`          | `{ conversationId }`                                     | After `DELETE /tabs/:id` removed a row (not sent when there was none).                                                                                             |
| `workspace.draft_updated`       | `{ conversationId, content: string \| null, updatedAt }` | After a draft was saved (`content`) or deleted (`null`). Ignore if `updatedAt` is not newer than the local copy, so a window does not overwrite text it is typing. |
| `workspace.preferences_updated` | `{ preferences: { restoreTabs, persistTabs } }`          | After `PATCH /preferences`.                                                                                                                                        |

## Data

`workspace_preferences.settings` (jsonb) holds `restoreTabs` and `persistTabs`; `workspace_open_conversations` holds
the tabs (unique per agent and conversation); the new `conversation_drafts` table holds drafts
(migration `20261106000000_conversation_drafts`: `content` is 1 to 10000 characters, cascade-deleted with the
conversation). Agent ids are Backend 1 ids with no foreign key.

## Tests

`pnpm --filter @chat-dashboard/backend test` covers the service rules with mocks (restore filtering, persistence flags,
tab limit, idempotence, permission checks, failed realtime push), the schemas, `visibleSummaries`, and the gateway
fan-out to several windows of one user. `workspace.integration.test.ts` runs against PostgreSQL
(`TEST_DATABASE_URL`, migration applied): concurrent opens of one tab, tab order and per-agent isolation, closing a tab
leaves the conversation row unchanged, unread counts on restore, hidden conversations omitted, tab limit, merged
concurrent preference updates, per-agent per-conversation drafts, the database length constraint and cascade delete.
