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

| Method | URL                           |
| ------ | ----------------------------- |
| GET    | `/api/health`                 |
| GET    | `/api/v1/agents/openapi.json` |

## Conversations

| Method | URL                                                                            | Body  |
| ------ | ------------------------------------------------------------------------------ | ----- |
| GET    | `/api/v1/agents/conversations?filter=all&page=1&size=20`                       |       |
| POST   | `/api/v1/agents/conversations`                                                 | below |
| GET    | `/api/v1/agents/conversations/{id}`                                            |       |
| GET    | `/api/v1/agents/conversations/{id}/activities?page=1&size=20`                  |       |
| PATCH  | `/api/v1/agents/conversations/{id}/status`                                     | below |
| POST   | `/api/v1/agents/conversations/{id}/archive`                                    | `{}`  |
| POST   | `/api/v1/agents/conversations/{id}/restore`                                    | `{}`  |
| GET    | `/api/v1/agents/conversations?customerId=00000000-0000-4000-8000-000000000100` |       |

List filters: `filter` = all, mine, unread, unassigned, archived; optional `status`, `priority`, `tag`, `q`, `customerId`,
`excludeId`.

Create (201; 200 when the open conversation for that `applicationId` is reused; only `customerId` is required):

```json
{
  "customerId": "00000000-0000-4000-8000-000000000100",
  "applicationId": 5001,
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

| Method | URL                                             | Body                                                                                                                                                            |
| ------ | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/v1/agents/conversations/{id}/assign`      | `{}` takes over as the caller                                                                                                                                   |
| POST   | `/api/v1/agents/conversations/{id}/assign`      | supervisor only: `{ "agentId": "00000000-0000-4000-8000-000000000004", "note": "please handle" }` (token `dev:00000000-0000-4000-8000-000000000009:SUPERVISOR`) |
| POST   | `/api/v1/agents/conversations/{id}/transfer`    | `{ "agentId": "00000000-0000-4000-8000-000000000004", "note": "handover" }`                                                                                     |
| POST   | `/api/v1/agents/conversations/{id}/unassign`    | `{ "note": "back to queue" }`                                                                                                                                   |
| GET    | `/api/v1/agents/conversations/{id}/assignments` |                                                                                                                                                                 |

## Messages (only the owner of an open conversation can send)

| Method | URL                                                                | Body                                                              |
| ------ | ------------------------------------------------------------------ | ----------------------------------------------------------------- |
| POST   | `/api/v1/agents/conversations/{id}/messages`                       | below                                                             |
| GET    | `/api/v1/agents/conversations/{id}/messages?limit=50`              |                                                                   |
| GET    | `/api/v1/agents/conversations/{id}/messages?before={messageId}`    | page back                                                         |
| GET    | `/api/v1/agents/conversations/{id}/messages?after={sequence}`      | what you missed                                                   |
| POST   | `/api/v1/agents/conversations/{id}/messages/{messageId}/delivered` | `{}` (customer messages only)                                     |
| POST   | `/api/v1/agents/conversations/{id}/read`                           | `{}` or `{ "messageId": "00000000-0000-4000-8000-000000000012" }` |
| POST   | `/api/v1/agents/conversations/{id}/unread`                         | `{}`                                                              |

Send (201; a retry with the same `clientId` returns 200 with the original message; `text` up to 4000 characters):

```json
{ "clientId": "msg-001", "text": "Hello from Postman", "replyToMessageId": "00000000-0000-4000-8000-000000000012" }
```

## Notifications

| Method | URL                                                       | Body                             |
| ------ | --------------------------------------------------------- | -------------------------------- |
| GET    | `/api/v1/agents/notifications?unread=true&page=1&size=20` |                                  |
| GET    | `/api/v1/agents/notifications/unread-count`               |                                  |
| PATCH  | `/api/v1/agents/notifications/{notifId}/read`             | `{}`                             |
| POST   | `/api/v1/agents/notifications/read-all`                   | `{}`                             |
| GET    | `/api/v1/agents/notifications/preferences`                |                                  |
| PUT    | `/api/v1/agents/notifications/preferences`                | below (any subset, at least one) |
| PUT    | `/api/v1/agents/conversations/{id}/mute`                  | `{ "muted": true }`              |

```json
{ "newMessage": true, "assignment": true, "transfer": true, "mention": true, "sound": false, "browser": true }
```

## Presence

| Method | URL                          | Body                                            |
| ------ | ---------------------------- | ----------------------------------------------- |
| GET    | `/api/v1/agents/presence`    | (lists only agents with an open WebSocket)      |
| PUT    | `/api/v1/agents/presence/me` | `{ "status": "AVAILABLE" }` (or `BUSY`, `AWAY`) |

## Customer info

| Method | URL                                                        |
| ------ | ---------------------------------------------------------- |
| GET    | `/api/v1/agents/conversations/{id}/customer`               |
| GET    | `/api/v1/agents/conversations/{id}/customer/conversations` |
| GET    | `/api/v1/agents/conversations/{id}/participants`           |

## How the collection is organised

Ten numbered folders, in the order to run them: each builds on the ones before (a signed-in token, a conversation you
own, a sent message), and each request that creates something saves its id (`convId`, `msgId`, `noteId`, `tagId`,
`templateId`, `escalationId`, `callbackId`, `callId`, `keywordId`, `reportId`, `reactionId`, ...) for the next ones.
Every folder and request carries a description.

| Folder                              | Sub-folders                                                      | Guide                                                                                                          | Needs                                                                                                                                                                                 |
| ----------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **01 Start here**                   | health, OpenAPI spec                                             | -                                                                                                              | no token                                                                                                                                                                              |
| **02 Staff sign-in**                | -                                                                | [api-auth.md](../api-auth.md)                                                                                  | the seed accounts from `user:seed-test` (admin@test.local / password123); the LOS request needs an LOS token: `pnpm los:token staff` makes a test one (`503` until LOS is configured) |
| **03 Accounts and roles**           | Accounts, Roles and permissions                                  | [api-auth.md](../api-auth.md), [api-roles.md](../api-roles.md)                                                 | an admin token                                                                                                                                                                        |
| **04 Conversations**                | Inbox and lifecycle, Assignment, Customer info                   | [api-conversations.md](../api-conversations.md), [api-tags-priority.md](../api-tags-priority.md)               | Create, then Take over: most later folders need a conversation you own                                                                                                                |
| **05 Messages**                     | Send and read, Message actions, Files and voice                  | [api-message-actions.md](../api-message-actions.md), [api-attachments.md](../api-attachments.md)               | uploads use `fixtures/sample.pdf` and `fixtures/sample.wav`                                                                                                                           |
| **06 Team tools**                   | Internal notes, Tags, Canned responses, Escalations              | [api-notes-escalations.md](../api-notes-escalations.md), [api-canned-responses.md](../api-canned-responses.md) | SHARED templates and resolving escalations need the supervisor token                                                                                                                  |
| **07 My workspace**                 | Notifications, Presence, Tabs and drafts, Chat settings, Profile | [api-workspace.md](../api-workspace.md), [api-chat-settings.md](../api-chat-settings.md)                       | -                                                                                                                                                                                     |
| **08 Callbacks, calls and closing** | Callbacks, Calls, Close the conversation                         | [api-callbacks.md](../api-callbacks.md), [api-calls.md](../api-calls.md)                                       | `scheduledAt` is set by a pre-request script; customer-started calls cannot be driven here                                                                                            |
| **09 Moderation**                   | -                                                                | [api-moderation.md](../api-moderation.md)                                                                      | keywords, reviews and the log need the supervisor token                                                                                                                               |
| **10 Mobile app (customer)**        | Customer sign-in, Chat                                           | [api-customer-mobile.md](../api-customer-mobile.md)                                                            | `customerToken` (saved by sign-in)                                                                                                                                                    |

A new endpoint goes into the folder of its feature, next to its siblings; a new feature gets its own sub-folder (or a
new numbered folder before 10, keeping the mobile folder last).

### Running the whole collection

Everyone signs in with **username and password**; no LOS and no dev mode are needed (`AUTH_MODE=jwt` works). Create the
test accounts once:

```sh
pnpm --filter @chat-dashboard/backend user:seed-test   # password: password123
```

| Account                 | Role       | Name in the story                                   |
| ----------------------- | ---------- | --------------------------------------------------- |
| `admin@test.local`      | ADMIN      | Chat Admin. Every staff request runs as this admin. |
| `supervisor@test.local` | SUPERVISOR | Supervisor Srey                                     |
| `agent1@test.local`     | AGENT      | Agent Sophea                                        |
| `agent2@test.local`     | AGENT      | Agent Rithy                                         |
| `customer1@test.local`  | CUSTOMER   | Dara                                                |
| `customer2@test.local`  | CUSTOMER   | Bopha                                               |

The collection then tells one conversation, top to bottom, each request saving the ids and tokens the later ones need:

1. **01 Start here:** Sophea, Rithy, Srey, Dara and Bopha sign in (`password` is the `testPassword` variable).
2. **02 Staff sign-in:** the admin signs in, refreshes, signs out, and changes the password and back.
3. **04 Conversations:** Dara opens the chat in the mobile app and asks when her loan will be approved. Staff find it
   in the inbox. Srey assigns it to Sophea, it is transferred to Rithy and unassigned, and staff take it over. Staff also
   open a second conversation with Dara about another application.
4. **05 Messages:** staff reply, Dara answers from the app, and staff mark her message delivered and read. Staff reply
   to her question, edit their greeting, react, and forward a message to her other conversation (then delete that
   copy). Then they send her a file and a voice message.
5. **06-08:** staff add notes, tags, templates and an escalation, then schedule a callback and call Dara. Finally they
   **resolve**, archive and restore the conversation.
6. **09 Moderation:** Bopha sends a phishing link from the app. Staff report it, block her, lift the block, block her by
   id, and lift it again at the end.
7. **10 Mobile app:** **Sokha** registers in the app (a new username each run) and uses every customer endpoint.

```sh
npx newman run docs/postman/chat-dashboard.postman_collection.json --working-dir docs/postman \
  --env-var baseUrl=http://localhost:4000
```

The run can be repeated on the same database. Each run starts new conversations, restores the admin's password,
and lifts Bopha's block.

**Every request succeeds** (no `401`, `403`, `404` or `409`). Staff call Dara and she declines, then answers in the app;
Dara calls staff, who answer, decline, or see her cancel (_08 / Calls_).

The other ways to sign in (_02 / Other ways to sign in_ and _10 / Sign in with LOS_) are **skipped** unless you switch
them on, so a plain run has nothing that can fail:

| Variable      | Set to `true` when                                                      | Runs                                       |
| ------------- | ----------------------------------------------------------------------- | ------------------------------------------ |
| `useDevLogin` | the backend has `AUTH_MODE=dev`                                         | _Dev sign-in, the LOS way_                 |
| `useLos`      | the mock LOS runs (`pnpm los:mock`, its lines in `.env`) or LOS is real | the _Mock LOS_ and _Sign in with LOS_ ones |

Set them in the collection's variables, or with `--env-var useLos=true` for newman.

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
- A wrong URL such as `GET /` or `/api/conversations` returns 404 (the staff API is under `/api/v1/agents`).

## Chat flow and real LOS (Dev): `los-dev.*`

`los-dev.postman_collection.json` and `los-dev.postman_environment.json` run the Chat flow against your local backend
(`chatUrl`, default `http://localhost:4000`). Import both, start the backend, and **Run collection**: it needs no setup
and passes on a re-run. Leave `chatCustomerUsername` empty and the first run creates a throwaway test customer and
reuses it; fill it in to use your own. The environment also holds the seeded dev staff account (`agent1`, see
`pnpm --filter @chat-dashboard/backend user:seed-test`); change it for your own. If a real agent takes the test
customer's conversation in the dashboard, the staff steps get 404: clear `chatCustomerUsername` to start a new customer.

**Bruno.** The same two files import into Bruno (_Import collection_ → Postman, and _Import environment_). They are
checked in Bruno's CLI too (`bru run -r --env dev`: 28 passed, 20 optional skipped). Bruno has no Postman working
directory: for `runPdf`, pick `fixtures/sample.pdf` in the upload request's file field.

1. **Customer.** Register (201, or 409 when it already exists), log in with username and password, refresh, join, send
   text (and the same text again: 200, no duplicate) and read messages.
2. **Staff.** Log in, read the customer's conversation, **take it** (an agent can reply only to a conversation they
   own), reply and release it. It uses the `chatConvId` the Customer folder saves.
3. **Checks.** Wrong password, unknown user, wrong endpoint, bad body, made-up refresh and LOS tokens, no token and a
   customer token on the staff API must all be refused.
4. **Sign out.** Ends both sign-ins.

The "Optional" folders are skipped until you turn them on with an environment variable set to `yes`:

- `runPdf`: the customer sends `fixtures/sample.pdf` and staff download it. Copy `docs/postman/fixtures/sample.pdf` into
  Postman's working directory first (or pick the file in the request's `file` field).
- `runChannel`: the app-style `/conversation` endpoints (get my conversation, send, resend, upload and send a PDF once, read messages); needs `fixtures/sample.pdf`.
- `runLos`: the real Dev LOS (`https://api-dev.los.delightech.asia/api/v1`): customer sign-in with LOS (fill
  `customerUsername` and `customerPin`, the LOS password; LOS allows 5 customer logins per 15 minutes, so do not loop
  it), LOS connectivity, the staff hand-off from LOS Web (its claim checks fail until LOS issues the Chat hand-off
  token, which is the point), the LOS loan-data endpoints, and "see real loan data in Chat". The backend must run with
  `LOS_ISSUER=los-backend` and the Dev `LOS_JWKS_URL` (see `backend/.env.example`). Tokens are never printed.

## Which collection to use

| File                                                                   | Use it for                                                                                               |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `chat-dashboard.postman_collection.json`                               | Every staff endpoint under `/api/v1/agents`, with dev tokens (`AUTH_MODE=dev`).                          |
| `los-dev.postman_collection.json` + `los-dev.postman_environment.json` | The Chat flow against your local backend (runnable), plus the optional real-LOS and app-channel folders. |

Fill the secret variables in your own copy of the environment; never commit them. The old `chat-backend` collection was
merged into `los-dev`: its app-style `/api/v1/customer/conversation` requests are the optional folder "customer app
channel" (turn it on with `runChannel` = `yes`; the PDF steps need `fixtures/sample.pdf` in Postman's working
directory), and its LOS sign-in steps are the existing LOS folders.
