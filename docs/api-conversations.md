# Conversations, assignments, messages, notifications and customer API

Base path `/api/v1/admin/conversations` (the staff namespace; health stays at `/api/health`). Responses use the envelopes in [api-response-contracts.md](api-response-contracts.md).
Ids are UUID strings. Timestamps are ISO 8601.

**Machine-readable spec:** `GET /api/v1/admin/openapi.json` (OpenAPI 3.1, generated from the code; this page is the narrative).

**Authentication:** every route needs `Authorization: Bearer <token>` from Backend 1. Only `AGENT`, `SUPERVISOR` and
`ADMIN` are accepted (customers get 403). Until the Backend 1 contract is provided, `AUTH_MODE=dev` accepts
`dev:<userUuid>:<ROLE>` tokens (rejected in production).

**Authorization:** see "As built" in [chat-logic-design.md](chat-logic-design.md). A conversation the caller may not
see is always `404`. Each conversation detail includes `permissions` flags computed by the same rules.

| Method | Path               | Body / query                                                                                                                                                               | Notes                                                                                                                                                  |
| ------ | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/`                | `filter` all\|mine\|unread\|unassigned\|archived, `status`, `priority`, `tag` (id), `tags` (ids), `tagMatch` any\|all, `sort` recent\|priority, `q`, `page`, `size` (≤100) | Paginated, newest activity first unless `sort=priority` (see [api-tags-priority.md](api-tags-priority.md)). `q` matches customer name, identifier, id. |
| POST   | `/`                | `customerId`, `applicationId?`, `customerName?`, `customerIdentifier?`, `subject?`, `priority?`                                                                            | 201 created; 200 when the open conversation for the application is reused.                                                                             |
| GET    | `/:id`             |                                                                                                                                                                            | Detail + `permissions` + `unreadCount`.                                                                                                                |
| GET    | `/:id/activities`  | `page`, `size`                                                                                                                                                             | Status, assignment and archive history.                                                                                                                |
| PATCH  | `/:id/status`      | `{ status: OPEN\|RESOLVED\|CLOSED }`                                                                                                                                       | Resolve/close need owner or supervisor; reopen any viewer. 409 if unchanged.                                                                           |
| POST   | `/:id/archive`     |                                                                                                                                                                            | Owner, supervisor, or anyone when unassigned.                                                                                                          |
| POST   | `/:id/restore`     |                                                                                                                                                                            |                                                                                                                                                        |
| POST   | `/:id/assign`      | `{ agentId?, note? }`                                                                                                                                                      | No `agentId` = take over. Assigning others: supervisor only.                                                                                           |
| POST   | `/:id/transfer`    | `{ agentId, note? }`                                                                                                                                                       | Owner or supervisor.                                                                                                                                   |
| POST   | `/:id/unassign`    | `{ note? }`                                                                                                                                                                | Back to the shared queue. Owner or supervisor.                                                                                                         |
| GET    | `/:id/assignments` |                                                                                                                                                                            | Full assignment history, newest first.                                                                                                                 |

### Messages and read state

| Method | Path                                 | Body / query                                    | Notes                                                                                       |
| ------ | ------------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------- |
| POST   | `/:id/messages`                      | `{ clientId, text (≤4000), replyToMessageId? }` | Owner only, open conversation. 201 created; **200 with the original message on a retry**.   |
| GET    | `/:id/messages`                      | `limit` (≤100, default 50), `before` or `after` | Oldest to newest. See cursors below.                                                        |
| POST   | `/:id/messages/:messageId/delivered` |                                                 | Delivery receipt for a customer message, recorded for the caller only.                      |
| POST   | `/:id/read`                          | `{ messageId? }`                                | Moves the caller's read position to that message (default: latest). Returns the read state. |
| POST   | `/:id/unread`                        |                                                 | Flags the conversation unread (count is at least 1) without moving the read position.       |

Reply, edit, delete, reactions and forward are in [api-message-actions.md](api-message-actions.md); the `Message` now also
carries `forwardedFromMessageId`, `isEdited`, `editedAt`, `reactions` and `attachments` (see [api-attachments.md](api-attachments.md)).

**Cursors.** `sequenceNumber` is strictly increasing per conversation. No cursor returns the newest page; `before=N`
returns the page of older messages; `after=N` returns what was missed since N (reconnect sync). `meta` has `hasMore`,
`direction`, `oldestSequence` and `newestSequence`. Soft-deleted messages are excluded.

**Message `status`** (sender-facing): `SENT` → `DELIVERED` → `READ`, never backwards. `SENDING` and `FAILED` exist in
the schema but nothing sets them yet (they belong to the client and the unbuilt customer channel).

**Read rules.** The server never marks anything read by itself: the client calls `/read` only while the conversation is
actually in view. The read position only moves forward, so an older tab cannot make messages unread again. Reading
records an `AGENT` receipt (delivered and read) for each customer message in the newly read range and marks those
messages `READ`. Unread = customer messages after the agent's position; `/unread` forces at least 1 until the next read.

**SYSTEM messages** (`senderType: "SYSTEM"`, `type: "SYSTEM"`, `metadata.event`) are posted for takeover, assignment,
transfer, unassign and status changes. They take a sequence number but do not change the inbox preview or last-activity
time and never count as unread.

### Presence

| Method | Path           | Body                                    | Notes                                                                                                     |
| ------ | -------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| GET    | `/presence`    |                                         | Agents with an open WebSocket and their status. Offline agents are not listed. (`/api/v1/admin/presence`) |
| PUT    | `/presence/me` | `{ status: AVAILABLE \| BUSY \| AWAY }` | Remembered for the next connection; broadcast as `presence.updated` while online.                         |

Realtime delivery of all of the above is described in [websocket-events.md](websocket-events.md).

### Notifications

Always the caller's own; another agent's notification is `404`. Realtime: `notification.new`, `notification.read`
([websocket-events.md](websocket-events.md)).

| Method | Path                          | Body / query                                | Notes                                                                            |
| ------ | ----------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------- |
| GET    | `/notifications`              | `unread=true`, `page`, `size`               | Newest first. `meta.unreadCount` is the caller's total unread.                   |
| GET    | `/notifications/unread-count` |                                             | Badge count.                                                                     |
| PATCH  | `/notifications/:id/read`     |                                             | Idempotent. Other sessions get `notification.read` with the new count.           |
| POST   | `/notifications/read-all`     |                                             | `{ updated, unreadCount: 0 }`.                                                   |
| GET    | `/notifications/preferences`  |                                             | `newMessage, assignment, transfer, mention, sound, browser`; all default on.     |
| PUT    | `/notifications/preferences`  | any subset of those booleans (at least one) | Switching a type off stops it being stored. `sound`/`browser` are client hints.  |
| PUT    | `/conversations/:id/mute`     | `{ muted: boolean }`                        | Stops new-message notifications for that conversation. Assignments still notify. |

Types generated: `NEW_MESSAGE` (to the owner of a conversation a customer wrote in), `NEW_CONVERSATION` (to online
AVAILABLE agents when a conversation starts waiting for a human), `ASSIGNED`, `TRANSFERRED`. Others exist in the schema
but have no trigger yet (`MENTION`, `CALL`, `HANDOFF`, `SYSTEM`). `CALLBACK` is sent by the callback job (`api-callbacks.md`).

### Customer information

All anchored to a conversation the caller can open, so customers cannot be looked up by id alone.

| Method | Path                                        | Notes                                                                                      |
| ------ | ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| GET    | `/conversations/:id/customer`               | Profile from Backend 1, redacted by role (below). `503` if Backend 1 is unreachable.       |
| GET    | `/conversations/:id/customer/conversations` | The customer's other conversations (archived and closed included) that the caller may see. |
| GET    | `/conversations/:id/participants`           | Current members first, then people who left; names from Backend 1.                         |
| GET    | `/conversations?customerId=`                | Same list as the inbox, filtered to one customer (also `excludeId`).                       |

Redaction (provisional until Backend 1 defines its permissions): name, avatar and `blacklisted` for anyone who can open
the conversation; `email`, `phone` for its owner and supervisors; `nationalId`, `occupation`, `salary` for supervisors
only. Hidden fields are `null` and named in `restricted`. `source: "dev-stub"` marks synthetic placeholder data
(`BACKEND1_MODE=dev`). The inbox and conversation detail now include `assignedAgent { id, name, avatarUrl }`
(`null` when unassigned or Backend 1 is unreachable).

Errors: `400` validation (`error.details` lists zod issues), `401` missing/invalid token, `403` role or permission,
`404` missing or hidden, `409` already in that state, lost a race (two agents claiming at once: one gets 409), or a
`clientId` already used by a different sender.

Example: `POST /api/v1/admin/conversations/12/assign` with `{}` as agent 1 →

```json
{
  "status": "success",
  "data": {
    "id": "00000000-0000-4000-8000-000000000005",
    "conversationId": "00000000-0000-4000-8000-000000000012",
    "agentId": "00000000-0000-4000-8000-000000000001",
    "assignedBy": "00000000-0000-4000-8000-000000000001",
    "type": "OWNER",
    "action": "TAKEOVER",
    "note": null,
    "assignedAt": "2026-11-05T04:00:00.000Z",
    "endedAt": null,
    "endedBy": null
  }
}
```
