# Message actions API (FR-16)

Reply, edit, delete, edit history, emoji reactions and forwarding. Routes are under `/api/v1/admin/messages`, need a
dashboard bearer token, and address a message **by id alone**. Every call first resolves the message's conversation
and applies the same visibility rule as the rest of the API (`canView`): a message the caller may not see, a deleted
one and one that does not exist all answer `404 Message not found`, so existence is not revealed.

Envelope: `{ "status": "success", "data": ... }`. Interactive reference: `GET /api/v1/admin/openapi.json`.
Copying a message is done by the browser (no API).

## The message object

`GET /conversations/:id/messages`, `message.new` and every response below return the same `Message`, now with:

| Field                    | Meaning                                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `replyToMessageId`       | The message this one answers (same conversation), or `null`.                                                                          |
| `forwardedFromMessageId` | The original, on a copy made by forward, or `null`. `metadata.forwardedFrom` has `{conversationId, messageId, senderType, senderId}`. |
| `isEdited`, `editedAt`   | Set by an edit. `createdAt` never changes.                                                                                            |
| `reactions[]`            | `{ id, userType, userId, emoji, createdAt }`, oldest first. Group by `emoji` for counts.                                              |
| `deletedAt`              | Set on a deleted message, which then has `content: null`, `metadata: null` and no reactions or attachments. Otherwise `null`.         |

Sender information is `senderType` and `senderId` (a Backend 1 id); names and avatars come from Backend 1, as for
`assignedAgent`. A reply quote is resolved by the client from `replyToMessageId` among the messages it holds.

## Endpoints

| Method and path                                     | Body                                 | Who and when                                                                                                                                                |
| --------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /messages/:messageId/replies`                 | `{ clientId, text }`                 | Same as sending: owner of an open conversation. 201, or 200 with the original on a retry.                                                                   |
| `PATCH /messages/:messageId`                        | `{ text }` (1 to 4000)               | The **author** only, text messages only, while they still own the open conversation. Unchanged text is a no-op.                                             |
| `DELETE /messages/:messageId`                       |                                      | The author, or a supervisor/admin for any agent, AI or customer message. SYSTEM messages never.                                                             |
| `GET /messages/:messageId/history`                  |                                      | The author and supervisors. Newest edit first. A deleted message's history: supervisors only.                                                               |
| `PUT /messages/:messageId/reactions`                | `{ emoji }`                          | Anyone who can see the conversation. Idempotent. Not on SYSTEM messages. Max 10 different emojis per user and message (409).                                |
| `DELETE /messages/:messageId/reactions/:reactionId` |                                      | The reaction's owner only (403 otherwise; 404 if it belongs to another message). Soft delete (`deleted_at`); reacting again with the same emoji revives it. |
| `POST /messages/:messageId/forwards`                | `{ targetConversationId, clientId }` | See the rules below. 201, or 200 with the existing copy on a retry.                                                                                         |
| `PUT /messages/:messageId/pin`                      |                                      | Owner or supervisor, or anyone while nobody owns the conversation (`canOrganize`). Idempotent. Not on SYSTEM messages. Max 10 pins per conversation (409).  |
| `DELETE /messages/:messageId/pin`                   |                                      | Same as pinning. 200 with `data: null`. Soft delete (`unpinned_at`); pinning again revives the row.                                                         |
| `GET /conversations/:id/pins`                       |                                      | Anyone who can see the conversation. The pin bar, newest pin first; deleted messages drop out. Staff only: customers never see pins.                        |

### Rules

- **Edit** saves the previous text in `message_edit_history` (editor, text, time) in the same transaction as the
  update, then sets `isEdited`/`editedAt`. If it was the newest message, the inbox `lastMessagePreview` follows.
- **Delete** is a soft delete (`deleted_at`, `deleted_by`); the row, its text and its edit history stay for audit, and
  its files are soft-deleted with it. In history and sync (staff and customer) a deleted message stays in its place as
  a placeholder (`deletedAt` set, no content, metadata, files or reactions) so clients show "This message was deleted".
  It no longer counts as unread. If it was the newest message the preview falls back to the newest remaining one (or
  empty).
- **Reactions** are unique per user, message and emoji (database key), so two simultaneous identical requests keep
  one. `emoji` must be an emoji or emoji sequence (skin tones, flags, keycaps, ZWJ), at most 50 characters.
- **Forward** copies a `TEXT` message (attachments arrive with FR-17) as a new agent message in the target and keeps
  `forwardedFromMessageId`. The caller must be able to see the source, and must own the target, which must be open.
  The customer's words may go **only to conversations of the same customer or to an `INTERNAL` conversation**, never
  into another customer's chat (403). Both conversations are locked in id order, so crossing forwards cannot deadlock.
  Resending the same `clientId` returns the same copy; using it for anything else is a 409.
- Closing the original or deleting it later does not alter existing copies.

### Errors

| Case                                                                                                  | Status   |
| ----------------------------------------------------------------------------------------------------- | -------- |
| Missing/invalid token, customer role                                                                  | 401, 403 |
| Hidden, deleted or unknown message or target                                                          | 404      |
| Editing/deleting someone else's message, wrong role, closed conversation, forwarding across customers | 403      |
| Non-text edit/forward, system message, invalid emoji, blank text                                      | 400      |
| 11th distinct reaction, reused `clientId`                                                             | 409      |

## WebSocket events (server to client)

These events are only pushed; the changes are made over REST. Common to all: **Sender** the server, after the REST
write committed. **Authentication** the `/ws` first-frame token. **Authorization** delivered per socket to whoever may
see the conversation (`canView`, supervisors included), so an agent never receives an event about a chat they could
not open. **Acknowledgment** none. **Error handling** a failed publish is logged and never fails the REST call;
clients re-read history on reconnect (`sync`).

| Event                      | Target                          | Payload                                                      | Server-side logic                                                                                                              |
| -------------------------- | ------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `message.updated`          | who can see the chat            | `{ message }` (full Message)                                 | After an edit. Replace the held copy. Followed by `conversation.updated` if the preview changed.                               |
| `message.deleted`          | who can see the chat            | `{ id, conversationId, deletedAt, deletedBy }`               | After a soft delete. Show it as deleted. Followed by `conversation.updated` if the preview changed.                            |
| `message.reaction_updated` | who can see the chat            | `{ conversationId, messageId, reactions[] }` (the full list) | After a reaction was added or removed. Replace the list, do not add to it.                                                     |
| `message.forwarded`        | who can see the **target** chat | `{ message, forwardedFrom: { conversationId, messageId } }`  | After a forward, together with the normal `message.new` and `conversation.updated` for the copy. The source chat gets nothing. |

The dashboard's own vocabulary is the same except `message.deleted` becomes `{ conversationId, messageId }`
(translated in `shared/api/ws/backend/translator.ts`).

## Frontend

`features/message-actions` (menu per message, inline editor), `shared/api/rest/messages.ts`, reply target in
`entities/message`, and a reply chip in the composer. The menu appears only against the real backend. Not built yet:
a UI for the edit history (`getEditHistory` exists) and forwarding into internal conversations.

## Tests

`pnpm --filter @chat-dashboard/backend test` covers the rules with mocked repositories (permissions for author,
supervisor, other agent and hidden messages; preview upkeep; capped reactions; forward privacy and idempotency; the
schemas). `message-actions.integration.test.ts` runs against PostgreSQL (`TEST_DATABASE_URL`): the edit trail, soft
delete and its effect on history, preview and unread counts, supervisor-only deletion of customer messages, one
reaction per user and emoji under simultaneous requests, reply idempotency, forwarding to the same customer, refusal for
another customer's chat, opposite forwards at the same time (no deadlock), and `clientId` reuse.
