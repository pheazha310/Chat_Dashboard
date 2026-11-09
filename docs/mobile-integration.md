# Mobile integration guide

How the customer's mobile app connects to the chat backend. Reference docs: [api-customer-mobile.md](api-customer-mobile.md)
(REST), [websocket-events.md](websocket-events.md#customer-connections) (realtime).

## Overview

| Concern              | How                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------- |
| Identity             | The chat backend signs customers in (its own account, or the LOS token) and issues tokens.   |
| Sending              | REST (`POST /api/v1/customer/...`), or `message.send` over the socket for text.              |
| Receiving            | `/ws` for live events, REST `?after=<seq>` to catch up. The app polls if the socket is down. |
| Same chat as the web | The dashboard and the app use the same conversations, messages and events.                   |

## Authentication and identity

1. The customer signs in once, either with the LOS access token the app already holds
   (`POST /api/v1/customer/auth/los` with `{ "losToken": "…" }`, no second password) or with a chat account
   (`POST /api/v1/customer/auth/register`, `POST /api/v1/customer/auth/login`). Both answer with an access token
   (`CUSTOMER_ACCESS_TOKEN_TTL_SECONDS`, 1 hour by default) and a refresh token. A sign-in lasts
   `REFRESH_TOKEN_TTL_DAYS` (30) from that moment; refreshing does not extend it, so after `refreshTokenExpiresAt` the
   app signs in again (with LOS this can happen silently). Before the access token expires, call
   `POST /api/v1/customer/auth/refresh` (one call at a time; store only the newest refresh token, in the platform's
   secure storage). Two parallel refreshes with the same token count as token reuse and sign the customer out, so
   when several requests get `401` together, let one refresh and make the others wait for its result. See [api-auth.md](api-auth.md). For local testing `AUTH_MODE=dev` also accepts
   `dev:<customerUuid>:CUSTOMER`.
2. Send `Authorization: Bearer <token>` on every REST call. Only `CUSTOMER` tokens are accepted under `/api/v1/customer`.
3. The customer is always the token's user. No request carries a customer id, and someone else's conversation, file or
   message answers `404`.
4. On first use the chat backend creates a `chat_users` row for the Backend 1 id (`GET /me` returns `chatUserId`). A
   disabled chat user gets `403`.

## Typical flow

```
GET  /api/v1/customer/me                            who am I
POST /api/v1/customer/conversations/join            { applicationId? }  -> conversation (201 new, 200 existing)
GET  /api/v1/customer/conversations/:id/messages    latest page (oldest to newest)
open wss://<host>/ws -> {type:"auth", payload:{token}} -> {type:"room.join", payload:{conversationId}}
POST /api/v1/customer/conversations/:id/messages    { clientId, text }
```

Every send needs a `clientId` (a UUID the app generates per message). If a request times out, resend with the **same**
`clientId`: the server returns the original message (`200`) instead of creating a duplicate.

## Messages

- **Text:** `POST /conversations/:id/messages` `{ clientId, text }` (up to 4000 characters), or `message.send` on the socket.
- **File (pdf, image, ...):** `POST /conversations/:id/files`, `multipart/form-data` with `file`, `clientId`, optional `text`.
- **Voice:** `POST /conversations/:id/voice-messages`, multipart with `file` (audio), `clientId`, optional `durationMs`
  and `waveform` (JSON array of up to 200 integers 0 to 255). Allowed audio: `audio/webm`, `audio/ogg`, `audio/mp4` (m4a), `audio/mpeg`,
  `audio/wav`; the server checks the real file content and the extension, not just the declared type. Files: images
  (jpeg, png, gif, webp up to 10 MB), pdf, doc/docx, xls/xlsx, txt, csv (size limits per type, up to 25 MB).
- **Show a message:** `senderType` is `CUSTOMER`, `AGENT` or `ASSISTANT`; `type` is `TEXT`, `IMAGE`, `FILE`, `VOICE`, ...;
  `attachments[]` carries `kind`, `fileName`, `fileSize`, `durationMs`, `waveform` and `downloadPath`.
- **Download:** `GET /api/v1/customer` + `downloadPath` with the bearer token. `?inline=1` for images/audio/video.
  Voice playback also at `GET /messages/:messageId/audio`. Both support `Range` for seeking.

Sending to a resolved or closed conversation reopens it. Blocked customers get `403`.

## Realtime (`/ws`)

1. Open `wss://<host>/ws`. The server sends `connection.established`.
2. Within 10 s send `{ "type": "auth", "payload": { "token": "<token>" } }`. Reply: `connection.authenticated`.
   After a reconnect send `"reconnect": true` and get `connection.reconnected`.
3. Send `room.join` `{ conversationId }` for the open conversation. Reply `room.joined` `{ conversationId,
lastSequenceNumber }`, or `room.error`. **Rooms are not remembered across connections: join again after every reconnect.**
4. Receive `message.new`, `message.updated`, `message.deleted`, `message.status`, `attachment.uploaded`, `typing`
   (the agent, `side: "agent"`). Send `typing.start` / `typing.stop`. `room.leave` when the screen closes.
5. Frames are JSON `{ type, payload }`, at most 64 KB. Close code `4401` means the token was missing or invalid, `4403`
   the role is not allowed.

## Staying in sync (reconnect)

Events missed while offline are **never replayed**. After reconnecting:

1. `auth` (with `reconnect: true`), then `room.join`.
2. `GET /conversations/:id/messages?after=<newestSequence the app holds>` until `meta.hasMore` is false.
3. De-duplicate by `message.id` or `clientId`: a live `message.new` can overlap the catch-up.
4. Refetch `GET /conversations/:id` if the status or `agentAssigned` matters. Customers do not receive
   `conversation.updated`.

The same applies when the app returns from the background, and it is the fallback if the socket cannot connect (poll
`?after=` every few seconds).

## Errors

Envelope `{ "status": "error", "error": { "code", "message" } }` ([api-response-contracts.md](api-response-contracts.md)).
`400` validation or a disallowed file, `401` missing or invalid token, `403` blocked customer or disabled chat user or a
staff token, `404` not found or not yours, `413` file too large, `429` too many sign-in attempts. Only sign-in,
registration and refresh are rate limited.

## Not available yet

Push notifications (FCM/APNs to `push_devices`), customer-side calls over REST, read receipts for customers, email
verification and "forgot password" by email.

## Trying it without the app

Import `docs/postman/chat-dashboard.postman_collection.json`: the "Mobile (customer) API" folder uses the
`customerToken` variable (`dev:00000000-0000-4000-8000-000000000101:CUSTOMER`) and saves nothing automatically, so copy
the conversation id from "Join room" into `customerConvId`.
