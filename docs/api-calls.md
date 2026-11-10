# Calls API (FR-26)

Voice (and video) calls between an agent and a customer. **This backend only does signalling and bookkeeping**: it
records the call, decides who may start, answer and end it, and relays WebRTC session descriptions. The audio itself
flows directly between the two browsers (WebRTC) and never touches this server; nothing of it is recorded or stored.

Call control is REST under `/api/v1/admin` (dashboard bearer token; customers get 403). Signalling is WebSocket. Interactive
reference: `GET /api/v1/admin/openapi.json`. Envelope: `{ "status": "success", "data": ... }`.

## The customer's side

The mobile app controls its half of a call over REST under `/api/v1/customer` (customer token,
[api-customer-mobile.md](api-customer-mobile.md)): `POST /conversations/:conversationId/calls` to call staff, and
`POST /calls/:callId/accept`, `/decline`, `/cancel`, `/end`. They call the service methods `initiateFromCustomer`,
`acceptByCustomer`, `declineByCustomer`, `cancelByCustomer` and `endByCustomer`, with the same rules as below.

**Still missing: real-time call events and signalling for customers.** Call events for the customer are published to the
user id `customerId` (`audience: users`), but customer sockets only receive a whitelist of message events of joined
rooms, and may not send `call.offer` / `call.answer` / `call.ice_candidate`. So the app does not learn about an incoming
call in real time, and WebRTC media cannot be set up with a customer yet: a call can be rung, answered and ended through
REST, but no audio flows. The customer's half is covered by tests that play the customer through the
service methods; the browser half is covered by tests with a fake `RTCPeerConnection`. Neither has run against a real
second browser.

## Lifecycle

```
RINGING --accept--> ACTIVE --end--> ENDED
   |-- decline --> DECLINED
   |-- cancel (caller) --> CANCELLED
   '-- nobody answers in time (job) --> MISSED          ACTIVE --too long (job)--> ENDED
```

`INITIATING` and `FAILED` exist in the schema, but nothing sets them yet (a call starts `RINGING`).

1. The **caller** starts the call (`RINGING`). An agent calls with `POST /conversations/:id/calls`; a customer through
   `initiateFromCustomer`.
2. The **callee** answers. For a call an agent started only the customer can answer. For a call a customer started, a
   supervisor, the conversation's owner, or any agent while nobody owns the conversation can; the first to answer wins and
   the others get `409`.
3. Only then does signalling begin: the **caller sends the offer**, the **callee the answer**, and both send ICE
   candidates. Nothing is relayed (or held) before the call is answered, so a session description never goes to someone
   who has not accepted.
4. Either party ends it. A supervisor can end any answered call.

A conversation has **at most one call that is not over**. The service checks first for a clear message, and the partial
unique index `calls_one_open_per_conversation` (migration `20261108000000_calls_one_open_per_conversation`) settles
simultaneous attempts: of four simultaneous starts, one wins.

## Endpoints

| Method and path                 | Who                                                                                                       |
| ------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `GET /calls/config`             | Any dashboard user. ICE servers and the ring timeout. `Cache-Control: no-store`.                          |
| `POST /conversations/:id/calls` | `{ callType?: AUDIO \| VIDEO }` (default AUDIO). The **owner** of a conversation that is not closed. 201. |
| `GET /conversations/:id/calls`  | Anyone who can see the conversation. Call history, newest first, paged.                                   |
| `GET /calls/:callId`            | Anyone who can see the call's conversation (otherwise 404).                                               |
| `POST /calls/:callId/accept`    | A ringing call a customer started (see rules above).                                                      |
| `POST /calls/:callId/decline`   | Same people as accept. `DECLINED`.                                                                        |
| `POST /calls/:callId/cancel`    | Only the caller, only while ringing. `CANCELLED`.                                                         |
| `POST /calls/:callId/end`       | A participant, or a supervisor, on an answered call. Records the duration.                                |

A call:

```json
{
  "id": "…",
  "conversationId": "…",
  "callType": "AUDIO",
  "status": "ACTIVE",
  "initiatedBy": { "type": "AGENT", "id": "…" },
  "participants": [
    { "type": "AGENT", "id": "…", "joinedAt": "…", "leftAt": null },
    { "type": "CUSTOMER", "id": "…", "joinedAt": "…", "leftAt": null }
  ],
  "startedAt": "…",
  "endedAt": null,
  "durationSeconds": null,
  "createdAt": "…",
  "permissions": { "canAccept": false, "canDecline": false, "canCancel": false, "canEnd": true }
}
```

The caller is listed first. `durationSeconds` is the time between answer and end. `permissions` are for the caller of
the API and are all false for states that allow nothing. Every state change races safely: each is a conditional update on
the current status, so two people acting at once cannot both win (the loser gets `409`).

Each start, answer, decline, cancel, end, missed call and automatic end adds a `CALL` entry to
`GET /conversations/:id/activities` (`metadata`: `callId`, `action`, and `durationSeconds` when it ended). The missed and
automatic ones are by `SYSTEM`. A customer's call that nobody answered also stores a `CALL` notification ("Missed call")
for the conversation's owner.

### ICE servers (`GET /calls/config`)

`{ iceServers: [{ urls, username?, credential? }], ringTimeoutSeconds }`, from the environment (below). With a TURN
shared secret each caller receives **short-lived credentials derived per user** (`username = <expiry>:<userId>`,
`credential = base64(HMAC-SHA1(secret, username))`, coturn `use-auth-secret`), valid for `CALL_TURN_TTL_SECONDS` (default
one hour), so a leaked credential stops working. A fixed account (`CALL_TURN_USERNAME` + `CALL_TURN_CREDENTIAL`) is the
fallback. Credentials are never logged or stored, and the response is never cached. **STUN/TURN are empty by default**: no
third-party server is contacted unless you configure one, which also means calls across different networks need your own
STUN/TURN to work.

## WebSocket signalling

Client to server (frames `{ type, payload }`, handled by the same gateway and validated with zod):

| Event                | Payload                                                                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `call.offer`         | `{ callId, sdp }` (sdp 1 to 20000 characters)                                                                                                   |
| `call.answer`        | `{ callId, sdp }`                                                                                                                               |
| `call.ice_candidate` | `{ callId, candidate }`; `candidate` is `{ candidate (≤ 2000), sdpMid?, sdpMLineIndex?, usernameFragment? }` or `null` for "no more candidates" |

Server to client:

| Event                        | Target                                                                                                                                                             | Payload                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `call.incoming`              | An agent's outgoing call: the **customer** only. A customer's call: everyone who may see the conversation (owner, supervisors, viewers; every agent while unowned) | `{ call }`                                                     |
| `call.accepted`              | Everyone who may see the conversation, and the customer                                                                                                            | `{ call, by: { type, id } }`                                   |
| `call.declined`              | same                                                                                                                                                               | `{ call, by }`                                                 |
| `call.ended`                 | same                                                                                                                                                               | `{ call, reason }` (`ended`, `cancelled`, `missed`, `timeout`) |
| `call.offer` / `call.answer` | **Only the other participant** of the call                                                                                                                         | `{ callId, from: { type, id }, sdp }`                          |
| `call.ice_candidate`         | Only the other participant                                                                                                                                         | `{ callId, from, candidate }`                                  |

Common to all: **Authentication** the `/ws` first-frame token (dashboard roles only). **Acknowledgment** none; success is
silent, and the effect is the event the other side receives. **Error handling** a rejected frame gets an `error` frame
`{ code, message, event }` and nothing is relayed; a failed publish of a lifecycle event is logged and never fails the
REST call or the job.

### Server logic and authorization of the three signalling events

For `call.offer`, `call.answer` and `call.ice_candidate` the server loads the call and:

1. `404 NOT_FOUND` if it does not exist.
2. `403 FORBIDDEN` unless the sender is one of the two parties who joined (so not a supervisor, not another agent, not
   another customer, even with the call id).
3. `409 CONFLICT` unless the call is `ACTIVE` (nothing before the answer, nothing after the end).
4. `403` if an offer comes from the callee or an answer from the caller.
5. `409` if the other side has already left.
6. Otherwise publishes the same message to the other party's user id with `from` set by the server (never taken from the
   sender), and keeps nothing.

Session descriptions are not inspected, only size-limited (also by the gateway's 64 KB frame limit). There is **no per-call
rate limit** on candidates beyond that; add one if abuse appears.

## Ring timeout and clean-up (the job)

A job in the API process (`CALL_JOB_INTERVAL_SECONDS`, default 10; `0` turns it off) marks `RINGING` calls older than
`CALL_RING_TIMEOUT_SECONDS` (default 45) `MISSED`, and ends calls still `ACTIVE` after `CALL_MAX_MINUTES` (default 240),
which would otherwise block the conversation forever if both browsers vanished. Calls are claimed with `UPDATE … WHERE
status = … AND id IN (SELECT … FOR UPDATE SKIP LOCKED) RETURNING`, so several API instances never handle the same call
twice and never wait for each other (tested with a row lock held by "another instance": the job skips it). The callback
job uses the same shape (its claim got the same outer status guard in this phase).

## Configuration

`CALL_RING_TIMEOUT_SECONDS`, `CALL_MAX_MINUTES`, `CALL_JOB_INTERVAL_SECONDS`, `CALL_STUN_URLS`, `CALL_TURN_URLS`,
`CALL_TURN_SECRET`, `CALL_TURN_TTL_SECONDS`, `CALL_TURN_USERNAME`, `CALL_TURN_CREDENTIAL` in `config/env.ts` and
`backend/.env.example` (names only; put real secrets in your untracked `.env`). URL lists are comma-separated.

## Frontend

`features/customer-call`:

- Against the real backend the call button in the chat header starts a **real call** (`startLiveCall`): REST for control,
  the WebSocket for signalling, `RTCPeerConnection` for audio, `getUserMedia({ audio })` for the microphone, ICE servers from
  `GET /calls/config`. `LiveCallDialog` shows ringing / incoming (Answer, Decline) / connecting / connected (timer, mute)
  / hang up. An incoming customer call opens the same dialog on every window that may see the conversation; when one
  answers, the others close with a notice. The microphone and connection are released on every way a call can end.
- An offer or candidates that arrive while the microphone permission prompt is open are kept and applied afterwards;
  candidates that arrive before the remote description wait for it.
- With the mock transport the old preview dialog is unchanged (it simulates a call).
- **Audio only.** `callType: VIDEO` is accepted by the API but the dashboard has no video UI. No keypad, no speaker
  selection, no reconnect after a network change (a failed connection ends the call).

## Tests

Unit: schemas; every rule of start, answer, decline, cancel, end and relay (who, when, which role); the ICE credential
derivation; the job. `calls.integration.test.ts` on PostgreSQL: the whole lifecycle with participants and timeline,
ownership, one open call (four simultaneous starts, and the index with the service bypassed), simultaneous answers (one
wins), signalling between the two parties only (outsiders, roles, before answer, after end), duration, the customer's own
calls, the job (ring timeout, never-finished calls, notifications, instances racing, a held row lock). The WebSocket test
runs real sockets: who receives `call.incoming`, `call.accepted` and `call.answer`, relaying an offer, and the error frames.
Frontend: the full browser flow with a fake peer connection, including the buffering above. Removing `SKIP LOCKED`, the
caller/callee role check, and either buffer each failed a test.
