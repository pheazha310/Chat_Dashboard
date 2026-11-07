# Customer mobile API

The customer's mobile app talks to the chat through REST under **`/api/v1/customer`**. It can **join a room**, **send
messages** (text, file, voice) and **retrieve messages**. It is separate from the staff API (`/api/v1/admin`): a
customer token is refused there with `403`, and a staff token is refused here.

Envelope: `{ "status": "success", "data": ... }` (errors as in [api-response-contracts.md](api-response-contracts.md)).

## Authentication

`Authorization: Bearer <token>`. Only tokens with role `CUSTOMER` are accepted, and the customer is **always the
token's user**: no request carries a `customerId`, so a customer can only ever reach their own conversations (someone
else's conversation, file or message is a `404`).

The real auth service contract is still unknown, so only the dev stand-in exists: with `AUTH_MODE=dev` a token is
`dev:<customerUuid>:CUSTOMER` (refused in production). `AUTH_MODE=external` stays unimplemented until Backend 1
provides its contract; the customer routes then use the same `AuthClient` port as the staff routes.

## Endpoints

| Method and path                                      | Purpose                                                                                                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /conversations/join`                           | **Join room.** Body `{ applicationId?, subject? }`. Finds the customer's conversation or creates one. `201` created, `200` existing.             |
| `GET /me`                                            | The customer's own profile from Backend 1: `userId`, `chatUserId`, `name`, `avatarUrl`, `email`, `phone` (no national id, salary or flags).      |
| `GET /me/conversations`                              | The customer's own conversations (customer-safe shape), latest activity first. `page`, `size`.                                                   |
| `GET /conversations/:conversationId`                 | The conversation (customer-safe shape, below).                                                                                                   |
| `GET /conversations/:conversationId/messages`        | **Retrieve messages**, oldest to newest. No cursor: latest page. `?before=<seq>` older, `?after=<seq>` newer (catch-up). `limit` 1 to 100.       |
| `POST /conversations/:conversationId/messages`       | **Send text.** Body `{ clientId, text }` (text up to 4000 characters).                                                                           |
| `POST /conversations/:conversationId/files`          | **Send file** (pdf, image, ...). Multipart: `file`, `clientId`, optional `text` caption. Allowed types and size limits as in the staff file API. |
| `POST /conversations/:conversationId/voice-messages` | **Send voice.** Multipart: `file` (audio), `clientId`, optional `durationMs`, optional `waveform` (JSON array of up to 200 integers 0 to 255).   |
| `GET /attachments/:attachmentId/download`            | A file's bytes (`?inline=1` for images, audio, video). One `Range` is supported (206).                                                           |
| `GET /messages/:messageId/audio`                     | The audio of a voice message, with `Range`.                                                                                                      |

A message's `attachments[].downloadPath` is relative to this base (`/attachments/<id>/download`), so the app fetches it
with the same bearer token.

## Join room

A "room" is a conversation. With `applicationId`, the customer has one open conversation per loan application; without
it, their latest conversation that is not closed is reused. A new conversation starts in `HUMAN` mode waiting for an
agent (the AI worker is not built), and available agents are notified.

```json
{
  "id": "…",
  "applicationId": "…",
  "subject": null,
  "status": "OPEN",
  "agentAssigned": false,
  "lastMessageAt": "2026-01-01T00:00:00.000Z",
  "lastMessagePreview": null,
  "lastSequenceNumber": "0",
  "createdAt": "2026-01-01T00:00:00.000Z"
}
```

No agent id, priority, tags or internal status is exposed. The application is not verified with Backend 1 (contract
unknown), as for the staff API.

## Sending

- Generate a `clientId` per message (a UUID). Resending the same `clientId` after a timeout returns the **original**
  message with `200` instead of creating a duplicate; the same holds for files and voice.
- A resolved or closed conversation is **reopened** by a new customer message, and the owning agent is notified.
- A **blocked** customer gets `403`. A message with a blocked keyword is kept and flagged for agents (see
  [api-moderation.md](api-moderation.md)).
- Uploads: `413` over the size limit, `400` for a disallowed type, mismatched extension or content.

## Retrieving

`data` is an array of messages (`id`, `sequenceNumber`, `senderType` `CUSTOMER`/`AGENT`/`ASSISTANT`, `type`, `content`,
`attachments`, `createdAt`, ...); `meta` holds `hasMore`, `oldestSequence`, `newestSequence`. Internal `SYSTEM` messages
(takeover, transfer, status changes) are left out and `metadata` is always `null`. To stay up to date, call
`?after=<newestSequence you hold>`; to scroll back, `?before=<oldestSequence you hold>`.

## Not built

- **Push notifications** to `push_devices` (FCM/APNs). Realtime over `/ws` is built: see
  [websocket-events.md](websocket-events.md#customer-connections); REST `?after=` remains the catch-up path after a reconnect.
- Calls from the customer side and per-message read/delivery receipts for customers (service methods exist for calls;
  no mobile route).
- Customer routes are not in the OpenAPI document (`/api/v1/admin/openapi.json`); the Postman collection has a "Mobile
  (customer) API" folder.
