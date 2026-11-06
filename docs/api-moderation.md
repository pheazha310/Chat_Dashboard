# Spam and moderation API (FR-27)

Blocking customers, blocked keywords, spam and abuse reports, and an audit log. Routes are under `/api/v1/admin` and need a
dashboard bearer token (customers get 403). Interactive reference: `GET /api/v1/admin/openapi.json`. Envelope:
`{ "status": "success", "data": ... }`.

## What "blocked" does, and what it does not

There is **no customer channel yet**, so nothing can actually be refused at the door today. The enforcement is built into
the entry points the customer channel will call, and is tested by playing the customer through them (like
`MessageService.receiveFromCustomer`, the calls in `api-calls.md`):

| Customer action                     | When the customer is blocked                  |
| ----------------------------------- | --------------------------------------------- |
| A message (`receiveFromCustomer`)   | Refused (`403`); nothing is stored            |
| A call (`initiateFromCustomer`)     | Refused (`403`)                               |
| Reporting spam (`reportByCustomer`) | Allowed (a blocked customer can still report) |

Blocking does **not** close or hide open conversations, and **agents can still write to a blocked customer's conversation**
(for example to explain). Unblocking restores everything. The block is by customer id (Backend 1's id), so it holds across
that customer's conversations.

A blocked **keyword never rejects a message**. A legitimate loan question ("is a wire transfer safe?") must not be lost to a
word list, so a matching message is stored normally and **flagged**: a `MODERATION` entry on the conversation timeline
(`metadata`: `messageId`, `matches` = how many keywords matched; never the keyword text) and the event `message.flagged`.
If you want matching messages rejected instead, that is a one-line change in `MessageService.receiveFromCustomer` plus a
decision about what the customer is told; it was not assumed.

## Who may do what

| Action                                    | Who                                                                                     |
| ----------------------------------------- | --------------------------------------------------------------------------------------- |
| Block via a conversation                  | The conversation's owner, or a supervisor. `POST /conversations/:id/customer-block`     |
| Block by customer id                      | Supervisors. `POST /moderation/customers/:customerId/block`                             |
| Unblock                                   | A supervisor, or the agent who blocked. Anyone else gets `404` (cannot tell if blocked) |
| List blocks                               | Supervisors: all. An agent: the ones they made. `GET /moderation/blocks?active=`        |
| Read keywords                             | Any dashboard user. `GET /moderation/keywords?q=`                                       |
| Add, rename, switch off, remove a keyword | Supervisors. `POST`, `PATCH`, `DELETE /moderation/keywords[/:keywordId]`                |
| Report spam                               | Anyone who can see the conversation. `POST /conversations/:id/spam-reports`             |
| List a conversation's reports             | Anyone who can see the conversation. `GET /conversations/:id/spam-reports`              |
| List the report queue                     | Supervisors: all (filter `status`). An agent: their own. `GET /moderation/spam-reports` |
| Confirm or dismiss a report               | Supervisors. `PATCH /moderation/spam-reports/:reportId`                                 |
| Read the moderation log                   | Supervisors. `GET /moderation/activities?targetType=&actorId=`                          |

These roles are the product rules assumed here (the brief did not name who moderates); they are enforced in the service.

### Blocks

`{ id, customerId, customerName, blockedBy, reason, blockedAt, unblockedAt, unblockedBy, permissions: { canUnblock } }`.
`customerName` comes from Backend 1 and is `null` when it cannot be reached (a list never fails because of that).
A customer has **at most one current block**: of four simultaneous attempts one wins and the rest get `409`, and the partial
unique index `customer_blocks_one_active` refuses a second row. A lifted block stays as history; the customer can be blocked
again later.

### Keywords

`{ id, keyword, isActive, createdBy, createdAt }`. Matching is plain text, ignoring case, anywhere in the message (`wire
transfer` matches "WIRE TRANSFER now"); it is not a regular expression, and `%` or `_` in a search are ordinary characters.
Unique ignoring case (`409`, also under simultaneous requests, by the `lower(keyword)` index). At most 1000 active ones. Control
characters are refused. Each process remembers the active list for 15 seconds; a change applies immediately on the instance that
made it and within 15 seconds on the others. `DELETE` removes the row for good (the log keeps the text).

### Spam reports

`{ id, conversationId, reportedBy: { type, id }, messageId, reason, status, reviewedBy, reviewedAt, resolutionNote, createdAt }`.
`reason` is required (≤ 2000). `messageId` is optional and must belong to the conversation (`400` otherwise). A reporter can
have **one pending report per message** (or one general one per conversation): a repeat is `409`, enforced by the partial
unique index `spam_reports_pending_once` (migration `20261109000000_spam_reports_one_pending`) so simultaneous duplicates also
fail. A report starts `PENDING`; a supervisor sets `CONFIRMED` or `DISMISSED` once (`409` if already reviewed), with an optional
`resolutionNote` (≤ 500). `{ "status": "CONFIRMED", "blockCustomer": true }` also blocks the conversation's customer **in the
same transaction** (if the review loses a race, the block is rolled back; a customer who is already blocked stays blocked and is
not logged twice). `blockCustomer` with a dismissal is `400`.

The customer channel will file customer reports through `ModerationService.reportByCustomer` (the customer must own the
conversation). They are listed like any other; they have no audit-log entry because the log's actor is always an agent.

### Audit log

Every moderation action by an agent writes a `moderation_activities` row: `BLOCK_CUSTOMER`, `UNBLOCK_CUSTOMER`,
`REPORT_SPAM`, `CONFIRM_SPAM`, `DISMISS_SPAM`, `ADD_KEYWORD`, `UPDATE_KEYWORD`, `REMOVE_KEYWORD`, with `targetType`
(`CUSTOMER`, `KEYWORD`, `SPAM_REPORT`), `targetId` and `metadata`. The row is written in the same transaction as the change, so
there is no change without a log entry. Actions tied to a conversation also add a `MODERATION` entry to
`GET /conversations/:id/activities`. The automatic keyword flag is not in the log (its actor would be the system, and the log's
actor column is an agent); it is on the conversation timeline.

## WebSocket events (server to client)

Common to all: **Sender** the server, after the change committed. **Target** everyone who may see the conversation (the
usual per-socket `canView` rule, which includes supervisors); nobody else receives them, so a report's text never reaches an
agent who cannot open the conversation. **Authentication** the `/ws` first-frame token. **Acknowledgment** none (not
client-sent). **Error handling** a failed publish is logged and never fails the REST call or the customer's message.

| Event              | Payload                                  | Server-side logic                                                                                                          |
| ------------------ | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `spam.reported`    | `{ report }`                             | After a report was filed (by an agent or a customer).                                                                      |
| `spam.reviewed`    | `{ report }`                             | After a supervisor confirmed or dismissed it.                                                                              |
| `customer.blocked` | `{ conversationId, customerId }`         | After a block made from that conversation, or by confirming its report. A block by id alone, and unblocking, send nothing. |
| `message.flagged`  | `{ conversationId, messageId, matches }` | A customer's message matched an active keyword.                                                                            |

There are no client-to-server moderation events: everything an agent does is REST.

## Frontend

- **Chat menu** (more options, real backend only): "Report spam or abuse" (asks for a reason) and, for the conversation's
  owner, "Block customer" (asks for an optional reason). The server decides who may and its refusal is shown.
  `features/moderate-conversation`.
- **Message settings dialog** (`features/message-settings`): "Blocked customers" and "Spam & abuse controls" now show the
  team-wide lists from the server (the header says "Shared with your team"). Supervisors can block by customer ID, add and
  remove keywords; agents see the keywords read-only and can unblock customers they blocked. **This changes what those two
  lists were**: they used to be a private, per-browser list of names; against the real backend they are shared and
  server-held, and entries typed there before are not migrated. With the mock transport the old local lists are unchanged.
- **Not built:** a screen for the spam report queue and its review (the API exists), the moderation log screen, flagging
  reported messages inside the message list, a "report this message" action on a single message, and showing a customer's
  blocked state in the conversation header. The dashboard also ignores the four events above for now.

## Tests

Unit: schemas; every permission and rule in the service (who may block, unblock, change keywords, review), keyword matching
and its cache, error and conflict cases. `moderation.integration.test.ts` on PostgreSQL: blocking and unblocking with timeline
and audit rows, ownership and viewers, four simultaneous blocks (one wins) and the index, a blocked customer's message and call
refused and allowed again after unblocking, agents still able to write, keywords flagging (not rejecting) with no keyword text in
the timeline, a switched-off or removed keyword taking effect, simultaneous duplicate keywords, `%` and `_` in search, reports
(simultaneous duplicates, message from another conversation, hidden conversation, customer reports), confirm with block and the
review race, a rolled-back block, queue visibility, the pending-report index, and the audit log. Removing the block check in
`receiveFromCustomer`, the unblock rule, or the keyword flag each failed tests.
