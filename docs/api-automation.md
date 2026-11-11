# Automation API: automatic replies and AI training examples

The team's two automatic replies (a first response and an away message) and the reply examples the team collects for the
future AI assistant. Routes are under `/api/v1/admin/automation` and need a dashboard bearer token (customers get 403).
Interactive reference: `GET /api/v1/admin/openapi.json`. Envelope: `{ "status": "success", "data": ... }`.

## Permissions

Everyone on staff can read both and propose a training example. **Saving the automatic replies and approving examples
needs `automation.manage`**, which migration `20261121000000_automation_settings` grants to `SUPERVISOR` and `ADMIN`
(an admin can change that under `/roles`, `docs/api-roles.md`). Without it the call gives `403`.

## Endpoints

| Method and path                                  | Body                                  | Notes                                                                                         |
| ------------------------------------------------ | ------------------------------------- | --------------------------------------------------------------------------------------------- |
| `GET /automation/auto-responses`                 |                                       | `{ awayMessage, firstResponse }`. A text is `null` until the team saves one                   |
| `PUT /automation/auto-responses`                 | `{ firstResponse, awayMessage }`      | Both required, 1-2000 characters after trimming. Saves both together and switches them on     |
| `GET /automation/training-examples`              |                                       | Newest first, pending and approved                                                            |
| `POST /automation/training-examples`             | `{ customerMessage, suggestedReply }` | Any staff user. The example starts `PENDING`                                                  |
| `PATCH /automation/training-examples/:exampleId` | `{ approved: boolean }`               | Needs `automation.manage`. Records `approvedBy`/`approvedAt`; `false` returns it to `PENDING` |

Unknown body keys are rejected with `400`; an unknown example id gives `404`.

## What is sent, and when

Stored as `automation_rules` (`trigger_type` `FIRST_RESPONSE` and `AWAY`, at most one each) and logged in
`automation_logs` (`SUCCESS` or `FAILED`, with the message id). **Nothing is sent for a trigger until the team has saved
its text.**

| Reply          | When                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| First response | Once, when a customer opens a **new** conversation (`join`). Joining an open conversation sends nothing                               |
| Away message   | When a customer sends a text, file or voice message and **no agent is `AVAILABLE`** (presence), at most once an hour per conversation |

The reply is stored as an `ASSISTANT` message (`messageType` `TEXT`, `senderId` null) with `metadata`
`{ automatic: true, trigger }`. It is an `ASSISTANT` message, not a `SYSTEM` one, because `SYSTEM` messages are internal
and never shown to customers. Like a `SYSTEM` message it does not change the inbox preview or the last-activity time, so
an automatic text never looks like an agent answered. The customer's history shows it with `metadata` removed; staff see
the `automatic` marker. A failure to send is logged and never fails the customer's own request. If presence (Redis) is
down, no agent counts as available.

## AI training examples

Stored in `ai_training_examples`. Approving only records the decision: **the AI worker is not built, so nothing reads
approved examples yet.**

## Dashboard

"Message setting" → "Auto-response settings" and "AI training data" (`features/message-settings`). Against the real
backend they read and write these endpoints and the header says "Shared with your team"; agents see the texts read-only
and cannot approve. With the mock transport both stay in the browser as before.

## Tests

`modules/automation/__tests__`: the auto-responder rules (once, hourly limit, no text saved, failures swallowed), the
service permissions, and an HTTP integration test on PostgreSQL (needs `TEST_DATABASE_URL`) that joins and writes as a
customer and reads the replies from the customer's history.
