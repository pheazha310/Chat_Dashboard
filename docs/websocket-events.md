# WebSocket contract (`/ws`)

Implemented in `backend/src/websocket/`. Frames are JSON text `{ "type": string, "payload": object }`, max 64 KB.
Event names are dotted (`message.send`); the colon names in the original brief map to them (see the last section).

> **Frontend status.** The frontend keeps its own event vocabulary (`frontend/src/shared/api/ws/protocol.ts`, also
> spoken by the mock server). With `VITE_WS_URL` set, `BackendSocket` + `BackendTranslator` translate to and from this
> contract; see [frontend-integration.md](frontend-integration.md) for the mapping. This document is the backend contract.

## Connection and authentication

1. Open `ws://host/ws`. Browsers send an `Origin` header; it must be in `CORS_ORIGIN` or the upgrade is refused (401).
2. The server sends `connection.established` `{ connectionId, authTimeoutMs }`.
3. Within `authTimeoutMs` (10 s) the client sends `auth` `{ token, reconnect? }`. The token is verified through the
   `AuthClient` (Backend 1; `dev:<userUuid>:<ROLE>` in dev). Only `AGENT`, `SUPERVISOR`, `ADMIN` are accepted.
4. Reply `connection.authenticated` (or `connection.reconnected` when `reconnect: true`) `{ connectionId, userId, role }`.
5. Failures: `error` then close `4401` (missing/invalid token, timeout, any event before `auth`) or `4403` (role not
   allowed). An oversized frame closes with `1009`; binary frames are refused.

The token is checked when the socket opens. Expiry and revocation mid-connection are not enforced until the Backend 1
contract says how to detect them.

## Client → server

All payloads reuse the REST request schemas, and the handlers call the same services, so every rule (visibility,
ownership, supervisor-only actions, idempotency) is identical to REST. A failure is `error` `{ code, message, event,
conversationId? }`, except `message.send`, which replies `message.failed`.

| Event                               | Payload                                                 | Same as REST                              | Reply / effect                                                                              |
| ----------------------------------- | ------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------- |
| `sync.request`                      | `{ selectedConversationId?, cursors? }`                 | inbox + messages `after`                  | `sync` (below)                                                                              |
| `message.send`                      | `{ conversationId, clientId, text, replyToMessageId? }` | `POST /conversations/:id/messages`        | `message.ack` to the sender; `message.new` to everyone else who can see it                  |
| `message.delivered`                 | `{ conversationId, messageId }`                         | `POST …/messages/:messageId/delivered`    | `message.status` DELIVERED to viewers                                                       |
| `conversation.read` / `.unread`     | `{ conversationId, messageId? }` / `{ conversationId }` | `POST /conversations/:id/read`, `/unread` | `conversation.read` to the agent's sessions; `message.status` READ to viewers               |
| `conversation.takeover`             | `{ conversationId }`                                    | `POST …/assign` `{}`                      | `conversation.assigned` (+ `conversation.hidden` for agents who lose access)                |
| `conversation.assign` / `.transfer` | `{ conversationId, agentId, note? }`                    | `POST …/assign`, `…/transfer`             | `conversation.assigned` / `.transferred`                                                    |
| `conversation.release`              | `{ conversationId, note? }`                             | `POST …/unassign`                         | `conversation.updated`                                                                      |
| `conversation.set_status`           | `{ conversationId, status }`                            | `PATCH …/status`                          | `conversation.status_changed`                                                               |
| `typing.start` / `typing.stop`      | `{ conversationId }`                                    | WebSocket only                            | `typing` to the others who can see the chat. Only the agent who can send may type (403/404) |
| `presence.set`                      | `{ status: AVAILABLE \| BUSY \| AWAY }`                 | `PUT /presence/me`                        | `presence.updated` to everyone                                                              |

## Server → client

Audience is evaluated **per socket** with the same `canView` rule as REST: an agent never receives an event about a
conversation they could not open. Supervisors see everything. "Owner's sessions" means every open socket of that agent.

| Event                                                 | Audience                                         | Payload                                                                                                                        |
| ----------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `connection.established`                              | the new socket                                   | `{ connectionId, authTimeoutMs }`                                                                                              |
| `connection.authenticated` / `connection.reconnected` | that socket                                      | `{ connectionId, userId, role }`                                                                                               |
| `sync`                                                | requester                                        | `{ conversations[], meta, messages{convId: Message[]}, incomplete[], presence[], notifications: { unreadCount }, serverTime }` |
| `message.ack`                                         | the sending socket only                          | `{ clientId, created, message }` (`created: false` on a retry; no second `message.new`)                                        |
| `message.new`                                         | who can see the chat, except the sender's socket | `{ message }`                                                                                                                  |
| `message.status`                                      | who can see the chat                             | `{ conversationId, messageIds[], status: DELIVERED \| READ }`                                                                  |
| `message.failed`                                      | the sending socket only                          | `{ conversationId, clientId, code, message }`                                                                                  |
| `conversation.created` / `.updated`                   | who can see the chat                             | `{ conversationId, conversation }` (no per-agent `unreadCount`; see below)                                                     |
| `conversation.assigned` / `.transferred`              | who can see it, plus the previous owner          | `{ conversationId, agentId, previousAgentId, assignedBy, action, conversation }`                                               |
| `conversation.status_changed`                         | who can see the chat                             | `{ conversationId, from, to, actorId, conversation }`                                                                          |
| `conversation.hidden`                                 | agents who can no longer see it                  | `{ conversationId }`. Sent when a waiting or AI-handled chat gets an owner. Remove it from the inbox.                          |
| `conversation.read`                                   | that agent's sessions                            | `{ conversationId, lastReadSequenceNumber, unreadCount, markedUnread }`                                                        |
| `typing`                                              | who can see the chat, except the typist's socket | `{ conversationId, userId, side: "agent", active }`                                                                            |
| `presence.updated`                                    | every dashboard socket                           | `{ userId, status: AVAILABLE \| BUSY \| AWAY \| OFFLINE }`                                                                     |
| `notification.new`                                    | the recipient's sessions                         | `{ notification: { id, type, title, body, conversationId, messageId, read, createdAt } }`                                      |
| `message.updated`                                     | who can see the chat                             | `{ message }` (an edit; replaces the held copy). See `api-message-actions.md`.                                                 |
| `message.deleted`                                     | who can see the chat                             | `{ id, conversationId, deletedAt, deletedBy }`                                                                                 |
| `message.reaction_updated`                            | who can see the chat                             | `{ conversationId, messageId, reactions[] }` (the full list)                                                                   |
| `message.forwarded`                                   | who can see the target chat                      | `{ message, forwardedFrom: { conversationId, messageId } }`, sent with `message.new` for the copy                              |
| `attachment.uploaded`                                 | who can see the chat                             | `{ attachment }`, sent with `message.new` for the file or voice message. See `api-attachments.md`.                             |
| `attachment.deleted`                                  | who can see the chat                             | `{ id, conversationId, messageId }`                                                                                            |
| `note.created` / `.updated`                           | who can see the chat                             | `{ note }`. See `api-notes-escalations.md`.                                                                                    |
| `note.deleted`                                        | who can see the chat                             | `{ id, conversationId }`                                                                                                       |
| `note.mentioned`                                      | the mentioned agent's sessions                   | `{ noteId, conversationId, mentionedBy, preview }`                                                                             |
| `conversation.escalated`                              | who can see the chat                             | `{ escalation }`; `status` is `PENDING`, `RESOLVED` or `CANCELLED`                                                             |
| `conversation.priority_changed`                       | who can see the chat                             | `{ conversationId, from, to, conversation }`. See `api-tags-priority.md`.                                                      |
| `conversation.tags_updated`                           | who can see the chat                             | `{ conversationId, conversation }`; `conversation.tags` is the new list                                                        |
| `workspace.tab_opened` / `.tab_closed`                | the acting agent's sessions                      | `{ conversationId, sortOrder, lastOpenedAt }` / `{ conversationId }`. See `api-workspace.md`.                                  |
| `workspace.draft_updated`                             | the acting agent's sessions                      | `{ conversationId, content \| null, updatedAt }`                                                                               |
| `workspace.preferences_updated`                       | the acting agent's sessions                      | `{ preferences: { restoreTabs, persistTabs } }`                                                                                |
| `error`                                               | the socket that caused it                        | `{ code, message, event?, conversationId? }`; codes match the REST error codes                                                 |

`Message`, `conversation` and `Assignment` are the REST DTOs ([api-conversations.md](api-conversations.md),
`GET /api/v1/admin/openapi.json`).

### Unread counts

`conversation` in events omits `unreadCount` because it is per agent and one event serves many agents. Clients add one
for each `message.new` from someone else in a chat they are not viewing, and replace it with the authoritative value on
`conversation.read`, `sync`, or any REST response.

### Typing

`typing.start` is announced once; repeating it only extends the indicator. It ends on `typing.stop`, after 5 s without
another `typing.start`, or when the socket closes. Nothing is stored.

### Presence

An agent is `OFFLINE` without an open socket, otherwise the status they chose (default `AVAILABLE`, remembered across
sessions). Going online/offline is announced only for the first/last socket. Live state is in Redis, history in
`agent_presence_history`. If Redis is down, presence is skipped and connections still work. Customer presence is not
available (no customer channel yet).

## Reconnection and synchronization

On reconnect the client authenticates again (`reconnect: true`) and sends
`sync.request { selectedConversationId, cursors: { "<conversationId>": "<last sequenceNumber held>" } }`. The reply has
the inbox (first 100, with per-agent `unreadCount`), the messages after each cursor (100 per conversation; the latest 50
for the selected one without a cursor), online agents, and `incomplete`: conversations with more missed messages than one
page, which the client pages over `GET /conversations/:id/messages?after=`. Conversations the agent can no longer see are
absent, and `message.id`/`sequenceNumber` let the client drop duplicates when a live `message.new` overlaps the sync.
Events missed while disconnected are never replayed; the sync is the recovery path.

## Multiple API instances

Services publish to an `EventBus`; `EVENT_BUS=redis` (default) relays events through the `chat:events` channel so every
instance delivers to its own sockets. `EVENT_BUS=memory` is for a single process. Publishing times out after 2 s and is
best effort: a failed publish is logged and never undoes the change.

## Brief → implementation names

| Brief                                     | Here                                                    |
| ----------------------------------------- | ------------------------------------------------------- |
| `connection:established`                  | `connection.established`                                |
| `connection:authenticated`                | `connection.authenticated`                              |
| `connection:disconnected`                 | the socket `close` event; presence goes `OFFLINE`       |
| `connection:reconnected`                  | `connection.reconnected`                                |
| `message:send` / `new` / `sent`           | `message.send` / `message.new` / `message.ack`          |
| `message:delivered` / `read`              | `message.status` with `DELIVERED` / `READ`              |
| `message:failed`                          | `message.failed`                                        |
| `typing:start` / `stop`                   | `typing.start` / `typing.stop` (server: `typing`)       |
| `presence:online` / `offline` / `updated` | `presence.updated` with `AVAILABLE`… / `OFFLINE`        |
| `conversation:created` / `updated`        | `conversation.created` / `conversation.updated`         |
| `conversation:assigned` / `transferred`   | `conversation.assigned` / `conversation.transferred`    |
| `conversation:status_changed`             | `conversation.status_changed`                           |
| `notification:new`                        | `notification.new`                                      |
| `notification:read`                       | **not yet**: needs the notification endpoints (Phase 6) |
