# Chat Dashboard — Backend Logic Design

## 1. Purpose and scope

This document describes how the chat backend should behave: who can see and do what,
and the step-by-step logic of each event. It builds on the data model in
`docs/database-schema.md` and the WebSocket contract in
`frontend/src/shared/api/ws/protocol.ts` (`ServerEventMap`, `ClientEventMap`).

The product is a loan-support chat with an AI-to-human handoff: customers talk to an
AI assistant, the AI escalates, and a human agent takes over.

The system is two independent backends plus web and mobile clients. **Backend 2 (chat, this repo)** owns
authentication and accounts (since 2026-11-07: `users`, scrypt passwords, JWT access tokens and rotating refresh
tokens, see [api-auth.md](api-auth.md)), conversations, messages, receipts, assignments, realtime and AI handoff.
**Backend 1 (main)** owns customers' loan applications and loan data. Its API contract is **not yet known and is not
designed here**; agent and customer names come from this backend's `users` table (`BACKEND1_MODE=local`).

## 2. Architecture

```
WebSocket gateway --> event handlers --> services (chat, handoff, ai) --> Prisma (chat PostgreSQL)
        ^                                        |   \
        '---- Redis pub/sub (fan-out) <----------'    '--> Backend 1 client (identity, permissions, customer/loan)
                                                    AI worker (queue job)   Push service (FCM / APNs)
```

- **Gateway:** authenticates the socket and routes events. It holds no business rules.
- **Services:** one function per use case, each running in a database transaction.
  Handlers only validate input and call a service.
- **Fan-out:** a service returns events; the gateway sends each event only to the sockets
  allowed to see it.
- **AI replies** run as a queue job, never inside the socket handler, because they are slow.

## 3. Connection, authentication and sync

1. The client signs in at `/api/v1/admin/auth/login` (staff) or `/api/v1/customer/auth/login` (customers) and
   connects with the access token. The server verifies the JWT locally (`JWT_SECRET`) and takes the user id (`sub`)
   and role from it. Refresh tokens live hashed in `refresh_tokens` ([api-auth.md](api-auth.md)).
2. Only users with role `AGENT`, `SUPERVISOR` or `ADMIN` can open the dashboard socket.
   Customers get a restricted event set on the same socket. Roles come from `users.role`.
3. On `sync.request` the server sends:
   - the inbox (see visibility rules below),
   - the last N messages per conversation (not the full history),
   - agents and unread notifications.
4. On reconnect the client sends `sync.request` again and merges by id. Missed events are
   not replayed; the client fetches messages after its last cursor (`created_at` / `id`), which is also how a
   mobile app catches up after a push notification.

**Visibility rule.** An agent sees a conversation if it is in the shared queue
(`NEEDS_HUMAN`), assigned to them, or they are a `VIEWER` on it. Other agents' chats are
read-only or hidden. Supervisors see everything.

## 4. Conversation states

Three separate fields on `conversations`: `status` (lifecycle), `conversation_mode` (`AI` or `HUMAN`, who answers) and
`handoff_status` (`NONE`, `NEEDS_HUMAN`, `ASSIGNED`). The authoritative owner is the open `OWNER` row in
`conversation_assignments` (`ended_at IS NULL`); `conversations.assigned_agent_id` mirrors it for fast inbox filters
and is set exactly when `handoff_status = ASSIGNED`.

```
NONE --(escalate / callback / customer asks)--> NEEDS_HUMAN --(takeover)--> ASSIGNED
 ^                                                                            |
 '------------------------(release / resolve)--------------------------------'
```

- `status`: `OPEN` -> `RESOLVED` -> `CLOSED`. A new customer message reopens a resolved or closed conversation
  (`status = OPEN`, `resolved_at` and `closed_at` cleared).
- Database rules: `ASSIGNED` requires `conversation_mode = HUMAN`; `OPEN` has no `resolved_at`/`closed_at`;
  `is_archived` agrees with `archived_at`; one open `OWNER` row per conversation.
- The value sets for these fields are proposals; see `docs/database-schema.md`.

## 5. Core flows

### 5.1 Customer sends a message

1. In one transaction:
   - `UPDATE conversations SET last_sequence_number = last_sequence_number + 1, last_message_at = now(),
last_message_preview = ... RETURNING last_sequence_number` (the row lock serializes senders);
   - insert the message with that `sequence_number` (`sender_type = CUSTOMER`, idempotent on `client_id`);
   - if the conversation was `RESOLVED` or `CLOSED`, reopen it.
2. Emit `message.new` and `conversation.updated` to the sockets allowed to see it.
3. Branch on `conversation_mode` and `handoff_status`:
   - `AI`: enqueue the AI job.
   - `NEEDS_HUMAN`: nothing more; the conversation waits in the queue.
   - `ASSIGNED`: notify only the owner.

The inbox preview is `last_message_preview`. A reader's unread count is `conversations.last_sequence_number` minus
that reader's `conversation_reads.last_read_sequence_number`.

Before building any DTO that needs customer or loan data, the service fetches it from Backend 1 by
`customer_id` / `application_id` (agent opens a conversation: flow G). That data is not stored here.

When a conversation is created for a customer and loan application, Backend 2 first verifies the customer and
application with Backend 1, then finds the existing active conversation for that application or creates one.

### 5.2 AI reply and escalation (queue job)

1. Re-read the conversation. If `conversation_mode` is no longer `AI` (an agent took over in the
   meantime), drop the job.
2. Generate the reply and insert `ASSISTANT` messages.
3. If the AI decides to escalate, or the customer asked for a person:
   - set `handoff_status = NEEDS_HUMAN` and raise `priority` if needed;
   - insert a `SYSTEM` message and a `conversation_activities` row;
   - create `notifications` for available agents.

### 5.3 Agent sends a message (`message.send`)

1. Permission: the sender must hold the open `OWNER` assignment. Otherwise reply with `message.error`.
2. Insert the message. The unique key `(conversation_id, client_id)` makes this idempotent:
   on a duplicate-key error, load the existing row and re-send the ack.
3. Update `last_message_at`, `last_message_preview` and `last_sequence_number` as in 5.1.
4. Reply `message.ack` carrying both `clientId` and the real message `id`.
5. Deliver through the customer's channel, then emit `message.status`:
   `sent` -> `delivered` -> `read`, or `failed` on error. Each recipient's delivery and read
   acknowledgement is saved in `message_receipts` before the status is relayed to the sender.
   Keep `messages.status` (SENT, DELIVERED, READ, FAILED) in step with the receipts.
6. If the recipient has no live socket and their `notification_preferences` allow it, send a push notification
   (FCM / APNs) to their active `push_devices` (`user_id`). Set `is_active = false` when the provider rejects a token.

### 5.4 Takeover (`conversation.takeover`)

Must be safe against two agents clicking at once. The conditional update decides the winner:

```ts
await prisma.$transaction(async (tx) => {
  const won = await tx.conversation.updateMany({
    where: { id, handoffStatus: "NEEDS_HUMAN" }, // a supervisor may also take an "AI" conversation
    data: { conversationMode: "HUMAN", handoffStatus: "ASSIGNED", assignedAgentId: agentId },
  });
  if (won.count === 0) throw new ConflictError("Already taken"); // loser receives an error event

  await tx.conversationAssignment.updateMany({
    where: { conversationId: id, endedAt: null, assignmentType: "OWNER" },
    data: { endedAt: new Date(), endedBy: agentId },
  });
  await tx.conversationAssignment.create({
    data: { conversationId: id, agentId, assignedBy: agentId, assignmentType: "OWNER", assignmentAction: "TAKEOVER" },
  });
  // also: SYSTEM message, conversation_activities row
});
```

Update the conversation pointer and the assignment rows in the same transaction; the database checks at commit that
`conversations.assigned_agent_id` matches the open `OWNER` row and rolls the transaction back otherwise.

Then emit `conversation.assigned`, `conversation.updated` and a notice. The database backs
this up: a partial unique index prevents two open `OWNER` rows, and a CHECK ties `ASSIGNED` to human mode.

### 5.5 Release, reassign, resolve

These events are not in the protocol yet and need to be added.

- **Release:** end the open `OWNER` row (`ended_at`, `ended_by`), clear `assigned_agent_id` and set
  `handoff_status = NEEDS_HUMAN` (or `NONE` with `conversation_mode = AI`) in the same transaction.
- **Reassign (supervisor only):** same as takeover, with the target agent chosen by the supervisor and
  `assigned_by` set to the supervisor.
- **Resolve:** `status = RESOLVED`, `resolved_at = now`, and release the agent.
  A scheduled job moves idle `RESOLVED` conversations to `CLOSED` (`closed_at`) after N days.

### 5.6 Read and unread (`conversation.read`)

Upsert `conversation_reads` for `(conversation, reader_type, reader_id)` with `last_read_message_id`,
`last_read_sequence_number`, `last_read_at` and `marked_unread = false`. "Mark as unread" sets `marked_unread = true`.
Each reader has their own position, so unread is per agent.

### 5.7 Other events

- **Typing:** a short-lived Redis key with a TTL plus a pub/sub event, so every server instance relays it;
  no database writes.
- **`callback.request`** (as built: REST instead of a socket event, see `api-callbacks.md`): insert a `callback_requests` row, notify the owner (or the queue if
  unassigned) and write a `conversation_activities` row.
- **Internal notes:** stored in `internal_notes`, never in `messages`, so they cannot be delivered to a
  customer; mentions go to `note_mentions` and create notifications.

## 5.8 As built (conversations and assignments)

Implemented in `shared/policy/conversation-access.ts`; the API returns the caller's `permissions` flags per conversation.

- **Visibility.** Supervisors see everything. An agent sees AI-handled (`NONE`) and waiting (`NEEDS_HUMAN`) conversations,
  ones they own, and ones where they are an open `VIEWER`. Another agent's `ASSIGNED` conversation is hidden: it
  returns 404 on every endpoint (never 403) and is excluded from search. This is stricter than the "read-only" wording
  in the matrix below; relax `canView` and `visibilityWhere` together if read-only access is wanted.
- **Unassigned filter** = waiting in the shared queue (`handoff_status = NEEDS_HUMAN`).
- **Unread** per agent = `CUSTOMER` messages after the agent's `last_read_sequence_number`, or at least 1 when
  `marked_unread`. The `unread` filter loads all such ids for the agent (fine at inbox scale; revisit if it grows).
- **Resolve/close** release the owner (`handoff NONE`, `AI` mode, OWNER row ended). **Reopen** (any viewer) sets
  `NEEDS_HUMAN`/`HUMAN` so an agent can take it over.
- **Archive/restore** is global (`is_archived`), allowed for the owner, a supervisor, or anyone when unassigned.
- **Create** finds or creates the open conversation per application. The customer/application are **not yet verified
  with Backend 1** (contract unknown); the target agent of an assign/transfer is likewise unverified.
- **Messages.** The conversation row is locked (`SELECT ... FOR UPDATE`) while a message is appended, so sequence
  numbers are contiguous and a retried `clientId` finds the original instead of failing on the unique key. Message
  `created_at` is the database clock (the same instant as `last_message_at`). `receiveFromCustomer` (reopen, notify the
  owner) is reached by the mobile REST API (`/api/v1/customer`, [api-customer-mobile.md](api-customer-mobile.md)); customers
  register and sign in at `/api/v1/customer/auth`.
- **Side effects after commit** (notifications, SYSTEM messages) are best effort: a failure is logged, never undoes the
  committed change.
- **Retention (FR-10):** only soft delete exists (deleted messages are excluded from history). No policy or job is
  defined anywhere, so none is built.
- **Realtime (built):** services report committed changes through `RealtimeNotifier`; the gateway authenticates sockets
  with a first-frame token and delivers each event only to sockets that pass `canView`. See
  [websocket-events.md](websocket-events.md). Event names are dotted (the decision recorded in §7 is closed).
- **Notifications.** Stored per agent, honouring their preference switches; new-message notifications also honour
  per-conversation mute. Triggers built: new customer message to the owner, a new waiting conversation to online
  AVAILABLE agents (not the creator), assigned and transferred. A customer message in a conversation nobody owns
  notifies no one (it waits in the queue, as designed in §5.1).
- **Customer data (Backend 1).** Reached only through the `Directory` port (`BACKEND1_MODE=dev` returns labelled
  synthetic data; `external` is not implemented because the contract is unknown). Sensitive fields are redacted by role
  with a provisional policy (see api-conversations.md); replace it when Backend 1 defines its permissions.
- **Not yet built:** push notifications to customers (the mobile REST API and customer sockets exist), customer-level communication activity (per-conversation activity exists),
  and the frontend integration (the frontend still talks to its mock protocol).
- **Timezone.** Database sessions are pinned to UTC (`config/database.ts`): the Prisma pg adapter reads `timestamptz`
  as UTC, so a non-UTC server timezone shifted database-generated timestamps by the offset.

## 6. Permission matrix

| Action       | AI-handled      | Waiting for human | Assigned to me | Assigned to someone else    |
| ------------ | --------------- | ----------------- | -------------- | --------------------------- |
| View         | agent: yes      | yes               | yes            | read-only (supervisor: yes) |
| Send message | no              | no                | yes            | no                          |
| Takeover     | supervisor only | yes               | n/a            | supervisor (reassign)       |
| Resolve      | supervisor      | no                | yes            | supervisor                  |

Enforce these in the service layer, not only in the UI.

"Supervisor" above means a role holding the matching permission (`conversations.view_all`, `conversations.manage_all`,
...). Since 2026-11-09 what each role may do is data (`roles`, `permissions`, `role_permissions`; `docs/api-roles.md`):
services check `can(auth, "module.action")`, and the seeded grants reproduce this matrix. Ownership rules (own
messages, notes, tags, callbacks, the conversation one owns) stay in code.

## 7. Protocol additions needed

The current protocol cannot express several cases. Add:

- `error` / `message.error` events with a code (`ALREADY_TAKEN`, `NOT_OWNER`, `NOT_FOUND`).
- `conversation.release`, `conversation.resolve`, `conversation.reassign`.
- `messages.history` (cursor pagination by `created_at` / `id`).
- `message.ack` must return `{ clientId, message }` so the client can map its optimistic id
  to the server id.
- The PDF names events `message:send`, `message:new`, `message:sent`, `message:delivered`, `message:read`,
  `typing:start`, `typing:stop`, `conversation:assigned`; the protocol uses dotted names (`message.ack`, ...).
  Pick one naming scheme and change protocol, gateway, frontend and mock together.
- REST paths in the PDF are under `/api/v1`; the chat backend mounts the staff API under `/api/v1/admin` (customer mobile app: `/api/v1/customer`; guest: `/api/v1/guest`, not built). `/api/health` is the only path outside it.
- The DTO `id` is currently the conversation slug (e.g. `maya`), but `conversations` has no `slug` column (ids are
  UUIDs). Either add a `slug` column or change the protocol to use the conversation UUID.

## 8. Differences from the current mock server

| Mock behaviour                                 | Real backend                                                |
| ---------------------------------------------- | ----------------------------------------------------------- |
| Broadcasts every event to every socket         | Per-socket visibility rules                                 |
| No authentication; agent hardcoded             | Access token verified on connect; real agent from the token |
| `message.ack` reuses `clientId` as the id      | Real integer id plus `clientId` mapping                     |
| `conversation.read` clears unread for everyone | Per-reader position in `conversation_reads`                 |
| No errors, no conflict check on takeover       | Conditional update and error events                         |
| Nothing persisted                              | PostgreSQL via Prisma                                       |

## 9. Build order

1. Backend skeleton, Backend 1 client and auth handshake (once its contract is known), and `sync`.
2. Customer and agent message flows with the idempotent ack.
3. Takeover with conflict handling, then release and resolve.
4. Fan-out with visibility rules, then Redis for multiple instances.
5. AI worker and escalation.
6. History paging, notifications, push (device tokens) and dashboard metrics (AI-handled share, time to assign,
   first response time, resolution time).
