# Postman: every endpoint with its body

Base URL `http://localhost:4000` (no trailing slash). Import `chat-dashboard.postman_collection.json` from this folder
to get all of these ready-made; the collection variables are `baseUrl`, `token`, `convId`, `msgId`, `notifId`.

Headers on every request except the three marked "no auth":

```
Authorization: Bearer dev:00000000-0000-4000-8000-000000000003:AGENT
Content-Type: application/json
```

Other dev tokens: `dev:00000000-0000-4000-8000-000000000004:AGENT`, `dev:00000000-0000-4000-8000-000000000009:SUPERVISOR` (needs `AUTH_MODE=dev`). IDs are strings. `{id}` is the conversation
id returned by Create. The database must be reachable: `GET /api/health` should say `"database": "up"`.

## Health and spec (no auth)

| Method | URL                          |
| ------ | ---------------------------- |
| GET    | `/api/health`                |
| GET    | `/api/v1/admin/openapi.json` |

## Conversations

| Method | URL                                                                           | Body  |
| ------ | ----------------------------------------------------------------------------- | ----- |
| GET    | `/api/v1/admin/conversations?filter=all&page=1&size=20`                       |       |
| POST   | `/api/v1/admin/conversations`                                                 | below |
| GET    | `/api/v1/admin/conversations/{id}`                                            |       |
| GET    | `/api/v1/admin/conversations/{id}/activities?page=1&size=20`                  |       |
| PATCH  | `/api/v1/admin/conversations/{id}/status`                                     | below |
| POST   | `/api/v1/admin/conversations/{id}/archive`                                    | `{}`  |
| POST   | `/api/v1/admin/conversations/{id}/restore`                                    | `{}`  |
| GET    | `/api/v1/admin/conversations?customerId=00000000-0000-4000-8000-000000000100` |       |

List filters: `filter` = all, mine, unread, unassigned, archived; optional `status`, `priority`, `tag`, `q`, `customerId`,
`excludeId`.

Create (201; 200 when the open conversation for that `applicationId` is reused; only `customerId` is required):

```json
{
  "customerId": "00000000-0000-4000-8000-000000000100",
  "applicationId": "00000000-0000-4000-8000-000000005001",
  "customerName": "Test Customer",
  "customerIdentifier": "CUS-0100",
  "subject": "Loan question",
  "priority": "MEDIUM"
}
```

Status (`OPEN`, `RESOLVED` or `CLOSED`; 409 if unchanged):

```json
{ "status": "RESOLVED" }
```

## Assignment

| Method | URL                                            | Body                                                                                                                                                            |
| ------ | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/v1/admin/conversations/{id}/assign`      | `{}` takes over as the caller                                                                                                                                   |
| POST   | `/api/v1/admin/conversations/{id}/assign`      | supervisor only: `{ "agentId": "00000000-0000-4000-8000-000000000004", "note": "please handle" }` (token `dev:00000000-0000-4000-8000-000000000009:SUPERVISOR`) |
| POST   | `/api/v1/admin/conversations/{id}/transfer`    | `{ "agentId": "00000000-0000-4000-8000-000000000004", "note": "handover" }`                                                                                     |
| POST   | `/api/v1/admin/conversations/{id}/unassign`    | `{ "note": "back to queue" }`                                                                                                                                   |
| GET    | `/api/v1/admin/conversations/{id}/assignments` |                                                                                                                                                                 |

## Messages (only the owner of an open conversation can send)

| Method | URL                                                               | Body                                                              |
| ------ | ----------------------------------------------------------------- | ----------------------------------------------------------------- |
| POST   | `/api/v1/admin/conversations/{id}/messages`                       | below                                                             |
| GET    | `/api/v1/admin/conversations/{id}/messages?limit=50`              |                                                                   |
| GET    | `/api/v1/admin/conversations/{id}/messages?before={messageId}`    | page back                                                         |
| GET    | `/api/v1/admin/conversations/{id}/messages?after={sequence}`      | what you missed                                                   |
| POST   | `/api/v1/admin/conversations/{id}/messages/{messageId}/delivered` | `{}` (customer messages only)                                     |
| POST   | `/api/v1/admin/conversations/{id}/read`                           | `{}` or `{ "messageId": "00000000-0000-4000-8000-000000000012" }` |
| POST   | `/api/v1/admin/conversations/{id}/unread`                         | `{}`                                                              |

Send (201; a retry with the same `clientId` returns 200 with the original message; `text` up to 4000 characters):

```json
{ "clientId": "msg-001", "text": "Hello from Postman", "replyToMessageId": "00000000-0000-4000-8000-000000000012" }
```

## Notifications

| Method | URL                                                      | Body                             |
| ------ | -------------------------------------------------------- | -------------------------------- |
| GET    | `/api/v1/admin/notifications?unread=true&page=1&size=20` |                                  |
| GET    | `/api/v1/admin/notifications/unread-count`               |                                  |
| PATCH  | `/api/v1/admin/notifications/{notifId}/read`             | `{}`                             |
| POST   | `/api/v1/admin/notifications/read-all`                   | `{}`                             |
| GET    | `/api/v1/admin/notifications/preferences`                |                                  |
| PUT    | `/api/v1/admin/notifications/preferences`                | below (any subset, at least one) |
| PUT    | `/api/v1/admin/conversations/{id}/mute`                  | `{ "muted": true }`              |

```json
{ "newMessage": true, "assignment": true, "transfer": true, "mention": true, "sound": false, "browser": true }
```

## Presence

| Method | URL                         | Body                                            |
| ------ | --------------------------- | ----------------------------------------------- |
| GET    | `/api/v1/admin/presence`    | (lists only agents with an open WebSocket)      |
| PUT    | `/api/v1/admin/presence/me` | `{ "status": "AVAILABLE" }` (or `BUSY`, `AWAY`) |

## Customer info

| Method | URL                                                       |
| ------ | --------------------------------------------------------- |
| GET    | `/api/v1/admin/conversations/{id}/customer`               |
| GET    | `/api/v1/admin/conversations/{id}/customer/conversations` |
| GET    | `/api/v1/admin/conversations/{id}/participants`           |

## FR-14 to FR-27 (enhanced and advanced chat)

The collection has one folder per feature, generated from the OpenAPI document (`/api/v1/admin/openapi.json`); each
request carries its description. Run **Conversations > Create**, **Assignment > Take over**, then **Messages > Send**
first: the requests below reuse `convId` and `msgId`, and the create requests save their ids (`noteId`, `tagId`,
`templateId`, `escalationId`, `callbackId`, `callId`, `keywordId`, `reportId`, `reactionId`) for the next ones.

| Folder                         | Guide                                                   | Needs                                                                                                                                                                   |
| ------------------------------ | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace                      | [api-workspace.md](../api-workspace.md)                 | -                                                                                                                                                                       |
| Message actions                | [api-message-actions.md](../api-message-actions.md)     | a sent message                                                                                                                                                          |
| Attachments                    | [api-attachments.md](../api-attachments.md)             | the upload requests point at `fixtures/sample.pdf` and `fixtures/sample.wav` (Postman: pick them, or any file, in form-data)                                            |
| Internal notes, Escalations    | [api-notes-escalations.md](../api-notes-escalations.md) | resolving an escalation needs the supervisor token                                                                                                                      |
| Tags, Conversations (priority) | [api-tags-priority.md](../api-tags-priority.md)         | -                                                                                                                                                                       |
| Canned responses               | [api-canned-responses.md](../api-canned-responses.md)   | creating a SHARED one needs the supervisor token                                                                                                                        |
| Chat settings                  | [api-chat-settings.md](../api-chat-settings.md)         | -                                                                                                                                                                       |
| Callbacks                      | [api-callbacks.md](../api-callbacks.md)                 | `scheduledAt` (at most 365 days ahead) is set by a pre-request script to two and three days from now                                                                    |
| Calls                          | [api-calls.md](../api-calls.md)                         | Accept/Decline of a customer's call need a call the customer started; there is no customer channel yet, so only an agent-started call can be driven here (it rings out) |
| Moderation                     | [api-moderation.md](../api-moderation.md)               | keywords, reviews and the log need the supervisor token                                                                                                                 |

### Running the whole collection

Against a fresh database with `AUTH_MODE=dev` and the admin `admin@example.com` / `change-me-please`
(`user:create-admin`), the collection runs top to bottom, each request saving the ids the later ones need:

```sh
npx newman run docs/postman/chat-dashboard.postman_collection.json --working-dir docs/postman \
  --env-var baseUrl=http://localhost:4000
```

All requests succeed except four that cannot from the staff side alone, and answer with the expected refusal: **Mark
delivered** (receipts exist only for customer messages), **Answer** and **Decline a customer's call** (the call was
started by the agent), and **Hang up** (that call was cancelled). It changes data (the admin's password becomes
`a-new-password`), so use a throwaway database.

New WebSocket frames (besides the list above): `call.offer`, `call.answer`, `call.ice_candidate`; see
[../api-calls.md](../api-calls.md).

## WebSocket (Postman: New, WebSocket)

Connect to `ws://localhost:4000/ws`. After `connection.established`, send `auth` within 10 seconds:

```json
{ "type": "auth", "payload": { "token": "dev:00000000-0000-4000-8000-000000000003:AGENT" } }
```

Then any of these frames:

```json
{ "type": "sync.request", "payload": { "selectedConversationId": "00000000-0000-4000-8000-000000000012", "cursors": { "12": "5" } } }
{ "type": "message.send", "payload": { "conversationId": "00000000-0000-4000-8000-000000000012", "clientId": "ws-001", "text": "Hi" } }
{ "type": "message.delivered", "payload": { "conversationId": "00000000-0000-4000-8000-000000000012", "messageId": "00000000-0000-4000-8000-000000000020" } }
{ "type": "conversation.read", "payload": { "conversationId": "00000000-0000-4000-8000-000000000012" } }
{ "type": "conversation.unread", "payload": { "conversationId": "00000000-0000-4000-8000-000000000012" } }
{ "type": "conversation.takeover", "payload": { "conversationId": "00000000-0000-4000-8000-000000000012" } }
{ "type": "conversation.assign", "payload": { "conversationId": "00000000-0000-4000-8000-000000000012", "agentId": "00000000-0000-4000-8000-000000000004", "note": "x" } }
{ "type": "conversation.transfer", "payload": { "conversationId": "00000000-0000-4000-8000-000000000012", "agentId": "00000000-0000-4000-8000-000000000004" } }
{ "type": "conversation.release", "payload": { "conversationId": "00000000-0000-4000-8000-000000000012", "note": "x" } }
{ "type": "conversation.set_status", "payload": { "conversationId": "00000000-0000-4000-8000-000000000012", "status": "RESOLVED" } }
{ "type": "typing.start", "payload": { "conversationId": "00000000-0000-4000-8000-000000000012" } }
{ "type": "typing.stop", "payload": { "conversationId": "00000000-0000-4000-8000-000000000012" } }
{ "type": "presence.set", "payload": { "status": "BUSY" } }
```

Full event list: [../websocket-events.md](../websocket-events.md).

## Checks worth running

- Agent 4 opens a conversation owned by agent 3: expect **404**, not 403.
- Agent 4 sends a message to it: rejected.
- No token: **401**.
- Send the same `clientId` twice: **201**, then **200**.
- A wrong URL such as `GET /` or `/api/conversations` returns 404 (the staff API is under `/api/v1/admin`).
