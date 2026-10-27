# Chat Dashboard — Backend Logic Design

## 1. Purpose and scope

This document describes how the chat backend should behave: who can see and do what,
and the step-by-step logic of each event. It builds on the data model in
`docs/database-schema.md` and the WebSocket contract in
`frontend/src/shared/api/ws/protocol.ts` (`ServerEventMap`, `ClientEventMap`).

The product is a loan-support chat with an AI-to-human handoff: customers talk to an
AI assistant, the AI escalates, and a human agent takes over.

## 2. Architecture

```
WebSocket gateway --> event handlers --> services (chat, handoff, ai) --> Prisma (MySQL)
        ^                                        |
        '---- Redis pub/sub (fan-out) <----------'          AI worker (queue job)
```

- **Gateway:** authenticates the socket and routes events. It holds no business rules.
- **Services:** one function per use case, each running in a database transaction.
  Handlers only validate input and call a service.
- **Fan-out:** a service returns events; the gateway sends each event only to the sockets
  allowed to see it.
- **AI replies** run as a queue job, never inside the socket handler, because they are slow.

## 3. Connection, authentication and sync

1. The client connects with an access token. The server validates it against the
   `sessions` table (token hash found, not revoked, not expired) and loads the user.
2. Only users with role `AGENT`, `SUPERVISOR` or `ADMIN` can open the dashboard socket.
   Customers use a separate channel.
3. On `sync.request` the server sends:
   - the inbox (see visibility rules below),
   - the last N messages per conversation (not the full history),
   - agents and unread notifications.
4. On reconnect the client sends `sync.request` again and merges by id. Missed events are
   not replayed.

**Visibility rule.** An agent sees a conversation if it is in the shared queue
(`NEEDS_HUMAN`), assigned to them, or they are a `VIEWER` on it. Other agents' chats are
read-only or hidden. Supervisors see everything.

## 4. Conversation states

`handoff` (who is handling) is separate from `status` (lifecycle).

```
AI --(escalate / callback / customer asks)--> NEEDS_HUMAN --(takeover)--> ASSIGNED
 ^                                                                          |
 '----------------------(release / resolve)--------------------------------'
```

- `status`: `OPEN` -> `RESOLVED` -> `CLOSED`. A new customer message reopens a resolved or
  closed conversation (`status = OPEN`, `closed_at = NULL`).
- Database rules: `handoff = ASSIGNED` exactly when `assigned_agent_id` is set; `closed_at`
  is set exactly when `status != OPEN`.

## 5. Core flows

### 5.1 Customer sends a message
1. In one transaction:
   - insert the message (`sender_type = CUSTOMER`);
   - update the conversation: `preview`, `last_message_at`, `unread_count + 1`;
   - if the conversation was `RESOLVED` or `CLOSED`, reopen it.
2. Emit `message.new` and `conversation.updated` to the sockets allowed to see it.
3. Branch on `handoff`:
   - `AI`: enqueue the AI job.
   - `NEEDS_HUMAN`: nothing more; the conversation waits in the queue.
   - `ASSIGNED`: notify only the owner.

### 5.2 AI reply and escalation (queue job)
1. Re-read the conversation. If `handoff` is no longer `AI` (an agent took over in the
   meantime), drop the job.
2. Generate the reply and insert `ASSISTANT` messages (no sender).
3. If the AI decides to escalate, or the customer asked for a person:
   - set `handoff = NEEDS_HUMAN` and `urgent = true`;
   - insert a `SYSTEM` message and an `activities` entry;
   - create `HANDOFF` notifications for available agents.

### 5.3 Agent sends a message (`message.send`)
1. Permission: the sender must be the active owner of the conversation. Otherwise reply
   with `message.error`.
2. Insert the message. The unique key `(conversation_id, client_id)` makes this idempotent:
   on a duplicate-key error, load the existing row and re-send the ack.
3. Update the conversation preview and time, and reset `unread_count`.
4. Reply `message.ack` carrying both `clientId` and the real message `id`.
5. Deliver through the customer's channel, then emit `message.status`:
   `sent` -> `delivered` -> `read`, or `failed` on error.

### 5.4 Takeover (`conversation.takeover`)
Must be safe against two agents clicking at once. The conditional update decides the winner:

```ts
await prisma.$transaction(async (tx) => {
  const won = await tx.conversation.updateMany({
    where: { id, handoff: { in: ["NEEDS_HUMAN", "AI"] } }, // "AI" only if the caller is a supervisor
    data: { handoff: "ASSIGNED", assignedAgentId: agentId, unreadCount: 0 },
  });
  if (won.count === 0) throw new ConflictError("Already taken"); // loser receives an error event

  await tx.agentConversation.updateMany({
    where: { conversationId: id, unassignedAt: null, role: "OWNER" },
    data: { unassignedAt: new Date() },
  });
  await tx.agentConversation.create({
    data: { agentId, conversationId: id, role: "OWNER" },
  });
  await tx.message.create({
    data: { conversationId: id, senderType: "ASSISTANT", type: "SYSTEM", text: "Agent took over" },
  });
});
```

Then emit `conversation.assigned`, `conversation.updated` and a notice. The database backs
this up: a CHECK keeps `handoff` and `assigned_agent_id` consistent, and a unique index
prevents two active owners.

### 5.5 Release, reassign, resolve
These events are not in the protocol yet and need to be added.
- **Release:** set `handoff = AI` (or `NEEDS_HUMAN`) and `assigned_agent_id = NULL` in a
  single statement, and close the owner row (`unassigned_at`).
- **Reassign (supervisor only):** same as takeover, with the target agent chosen by the
  supervisor.
- **Resolve:** `status = RESOLVED`, `closed_at = now`, and release the agent.
  A scheduled job moves idle `RESOLVED` conversations to `CLOSED` after N days.

### 5.6 Read and unread (`conversation.read`)
Upsert `conversation_reads(user, conversation, now)`. Reset the shared `unread_count` only
when the owner reads the conversation.

### 5.7 Other events
- **Typing:** relayed in memory or Redis; no database writes.
- **`callback.request`:** create a `CALLBACK` notification for the owner (or the queue if
  unassigned) and an `activities` entry.
- **Internal notes:** messages with `type = NOTE` are never delivered to the customer;
  filter them in the delivery step.

## 6. Permission matrix

| Action | AI-handled | Waiting for human | Assigned to me | Assigned to someone else |
|---|---|---|---|---|
| View | agent: yes | yes | yes | read-only (supervisor: yes) |
| Send message | no | no | yes | no |
| Takeover | supervisor only | yes | n/a | supervisor (reassign) |
| Resolve | supervisor | no | yes | supervisor |

Enforce these in the service layer, not only in the UI.

## 7. Protocol additions needed

The current protocol cannot express several cases. Add:
- `error` / `message.error` events with a code (`ALREADY_TAKEN`, `NOT_OWNER`, `NOT_FOUND`).
- `conversation.release`, `conversation.resolve`, `conversation.reassign`.
- `messages.history` (cursor pagination by `created_at` / `id`).
- `message.ack` must return `{ clientId, message }` so the client can map its optimistic id
  to the server id.
- The DTO `id` is currently the conversation slug (e.g. `maya`); the server maps slug to
  the uuid primary key.

## 8. Differences from the current mock server

| Mock behaviour | Real backend |
|---|---|
| Broadcasts every event to every socket | Per-socket visibility rules |
| No authentication; agent hardcoded | Session-based auth; real agent from the token |
| `message.ack` reuses `clientId` as the id | Real uuid plus `clientId` mapping |
| `conversation.read` clears unread for everyone | Per-user read state; shared badge cleared by the owner |
| No errors, no conflict check on takeover | Conditional update and error events |
| Nothing persisted | MySQL via Prisma |

## 9. Build order

1. Backend skeleton, auth handshake (sessions) and `sync`.
2. Customer and agent message flows with the idempotent ack.
3. Takeover with conflict handling, then release and resolve.
4. Fan-out with visibility rules, then Redis for multiple instances.
5. AI worker and escalation.
6. History paging, notifications and dashboard metrics (AI-handled share, time to assign,
   first response time, resolution time).
