# Callbacks API (FR-25)

An agent schedules a time to call a customer back. The assignee gets a reminder shortly before, a callback nobody
handled shortly after its time is marked missed, and everything shows on the conversation's timeline. Routes are under
`/api/v1/admin` and need a dashboard bearer token (customers get 403). Interactive reference:
`GET /api/v1/admin/openapi.json`. Envelope: `{ "status": "success", "data": ... }`.

This backend only **records and reminds**. It never places a call (that is FR-26, a later phase).

## Endpoints

| Method and path                        | Body / query                                          | Who                                                                         |
| -------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------- |
| `POST /conversations/:id/callbacks`    | `{ scheduledAt, notes?, assignedAgentId? }`           | Anyone who can see the conversation. 201.                                   |
| `GET /conversations/:id/callbacks`     |                                                       | Anyone who can see the conversation. Any status, soonest first.             |
| `GET /callbacks`                       | `status`, `from`, `to`, `scope`, `page`, `size`       | My callbacks (assigned to me or scheduled by me). `scope=all`: supervisors. |
| `GET /callbacks/:callbackId`           |                                                       | Its assignee, its creator, supervisors, or anyone who can see the chat.     |
| `PATCH /callbacks/:callbackId`         | `{ scheduledAt?, notes?, assignedAgentId? }` (one of) | Assignee, creator or supervisor. Open callbacks only.                       |
| `POST /callbacks/:callbackId/complete` | `{ completionNote? }`                                 | Assignee, creator or supervisor. From PENDING or MISSED.                    |
| `POST /callbacks/:callbackId/cancel`   |                                                       | Assignee, creator or supervisor. From PENDING or MISSED.                    |

`PATCH` and the two `POST` actions are an addition to the minimum list (create, list): without them a callback could
never be rescheduled, finished or dropped. Anyone else who can merely see the conversation (a viewer) gets `403` on
changes; someone who cannot see it gets `404`.

```json
{
  "id": "…",
  "conversationId": "…",
  "customerId": "…",
  "assignedAgentId": "…",
  "createdBy": "…",
  "scheduledAt": "2026-11-20T09:30:00.000Z",
  "status": "PENDING",
  "notes": "Customer prefers calls after 5pm",
  "completionNote": null,
  "createdAt": "…",
  "completedAt": null,
  "permissions": { "canEdit": true, "canComplete": true, "canCancel": true }
}
```

`permissions` are for the caller and are false once the callback is closed.

### Rules

- **Time:** `scheduledAt` is ISO 8601 **with an offset** (`Z` or `+07:00`); a time without one is refused rather than read
  in the server's time zone. It must be in the future and at most 365 days ahead (`400`). Stored in UTC.
- **Customer:** taken from the conversation, never from the request. A conversation without a customer (internal) gives `409`.
- **Assignee:** defaults to the conversation's owner, else the caller. Naming another agent requires that they exist in
  Backend 1 and could open the conversation (checked as a plain agent, as for note mentions): otherwise `400` and nothing is
  stored; `503` if Backend 1 cannot be reached. Naming yourself needs no check.
- **Limit:** at most 20 pending callbacks per conversation (`409`). This is a soft limit: two requests at the same moment
  could both pass it.
- **Notes** (≤ 2000 characters) are internal, like internal notes: customers never see them.
- **Statuses** `PENDING` → `COMPLETED` | `CANCELLED` | `MISSED` (set by the job). `MISSED` can still be completed (a late
  call still counts), cancelled or rescheduled. A new `scheduledAt` makes it `PENDING` again and allows a new reminder;
  changing the assignee also allows a reminder for the new assignee. `COMPLETED` and `CANCELLED` are final (`409`).
  Every change is a conditional update on the status, so two people acting at once cannot both win (the loser gets `409`),
  and the database refuses `COMPLETED` without `completed_at`.
- **Timeline:** every creation, change and outcome adds a `CALLBACK` entry to `GET /conversations/:id/activities`
  (`metadata`: `callbackId`, `action` = `created`, `rescheduled`, `updated`, `completed`, `cancelled`, `missed`). The
  `missed` entry is by `SYSTEM`, with no actor.

## Reminders and missed callbacks (the job)

A job inside the API process runs every `CALLBACK_JOB_INTERVAL_SECONDS` (default 30; `0` turns it off). Each pass:

1. Marks `PENDING` callbacks more than `CALLBACK_MISSED_AFTER_MINUTES` (default 15) past their time as `MISSED`, adds the
   `missed` timeline entry, stores a `CALLBACK` notification "Missed callback" for the assignee and broadcasts
   `callback.missed`.
2. Reminds the assignee of `PENDING` callbacks due within `CALLBACK_REMINDER_MINUTES` (default 10): a stored `CALLBACK`
   notification ("Callback reminder", which the dashboard shows as a toast) and the live event `callback.reminder`.
   Callbacks already past their time but still inside the 15-minute grace period are reminded too.

**Several instances are safe, and no Redis lock is used.** Each callback is claimed in a single `UPDATE … WHERE id IN
(SELECT … FOR UPDATE SKIP LOCKED) RETURNING`: `reminder_sent_at` is stamped, or the status set to `MISSED`, by exactly one
instance, so overlapping instances and repeated passes never send a second reminder or a second missed notice. This was
chosen over the Redis lock that was first planned because the claim is itself the guarantee; a lock would only add a
failure mode. Tested with five passes racing over six callbacks: six reminders, six missed marks.

**At most once.** The claim is committed before the notification is sent. If sending then fails, it is logged and not
retried (a reminder that is late is useless anyway). If the whole API is down, a callback that becomes overdue is
marked `MISSED` when it comes back up (reminders for callbacks past the grace period are skipped, they are marked missed
instead). A stored notification is created even when the assignee is offline; they see it on their next load.

A callback is not reminded about when it has no assignee, or after completion or cancellation. An agent never receives a
notification for a change they made themselves.

## WebSocket events (server to client)

Common to all: **Sender** the server, after the change committed. **Authentication** the `/ws` first-frame token.
**Acknowledgment** none (not client-sent). **Error handling** a failed publish is logged and never fails the REST call
or the job; clients re-read over REST. Payload `callback` is the DTO above without `permissions` (receivers work out
their own rights).

| Event                | Target                                             | Payload        | Server-side logic                                |
| -------------------- | -------------------------------------------------- | -------------- | ------------------------------------------------ |
| `callback.created`   | Everyone who can see the conversation (per socket) | `{ callback }` | After `POST`.                                    |
| `callback.updated`   | same                                               | `{ callback }` | After a reschedule, note or assignee change.     |
| `callback.completed` | same                                               | `{ callback }` | After completion.                                |
| `callback.cancelled` | same                                               | `{ callback }` | After cancellation.                              |
| `callback.missed`    | same                                               | `{ callback }` | When the job marks it missed.                    |
| `callback.reminder`  | Only the assignee, on all of their sessions        | `{ callback }` | When the job reminds. Never sent to anyone else. |

Because notes are internal, these events go only to people who may see the conversation, never to the customer.

## Configuration

`CALLBACK_JOB_INTERVAL_SECONDS` (30), `CALLBACK_REMINDER_MINUTES` (10), `CALLBACK_MISSED_AFTER_MINUTES` (15), in
`backend/.env.example` and `config/env.ts`. The job is started in `server.ts` only, so tests and one-off scripts that
import the app never start a timer.

## Frontend

`features/request-callback`: a "Callbacks" entry in the chat's more menu opens a panel in the customer-details column
(`CallbacksPanel`): a date-and-time field (read in the browser's time zone and sent with an offset), an optional note, the
conversation's open callbacks with "Mark done" (asks how the call went) and "Cancel", and earlier ones below. It appears
only against the real backend (`API_URL`). `shared/api/rest/callbacks.ts` is the REST client.

Reminders reach the agent as a normal notification toast. **Not built:** a screen listing all of my callbacks
(`GET /callbacks` has no UI), rescheduling and reassigning from the panel (the endpoint exists), live refresh of the panel
from `callback.*` events (it reloads when opened and after each action, and the frontend ignores these events for now),
and customer-facing scheduling (no customer channel yet). The old "Send Callback" button in the handoff card is hidden by
CSS and still sends the mock-only `callback.request` event, which the backend does not accept.

## Tests

Unit tests cover the schemas, permissions, assignee checks, time rules, notification and realtime failure, the job pass
and the timer (overlapping ticks, stop, disabled). `callbacks.integration.test.ts` runs the real services against
PostgreSQL: creation with timeline entry and event, hidden conversations, viewers, assignees, one reminder only and again
after a reschedule, the missed grace period and late completion, closed callbacks left alone, five job passes racing,
simultaneous complete/cancel (one wins), the pending limit, listing with filters, and the database constraint. Removing
the `reminder_sent_at` guard failed two tests and removing `SKIP LOCKED` failed the racing test.
