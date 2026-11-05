# Conversations and assignments API

Base path `/api/conversations`. Responses use the envelopes in [api-response-contracts.md](api-response-contracts.md).
Ids are strings (PostgreSQL `BIGINT`). Timestamps are ISO 8601.

**Authentication:** every route needs `Authorization: Bearer <token>` from Backend 1. Only `AGENT`, `SUPERVISOR` and
`ADMIN` are accepted (customers get 403). Until the Backend 1 contract is provided, `AUTH_MODE=dev` accepts
`dev:<userId>:<ROLE>` tokens (rejected in production).

**Authorization:** see "As built" in [chat-logic-design.md](chat-logic-design.md). A conversation the caller may not
see is always `404`. Each conversation detail includes `permissions` flags computed by the same rules.

| Method | Path               | Body / query                                                                                                   | Notes                                                                        |
| ------ | ------------------ | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| GET    | `/`                | `filter` all\|mine\|unread\|unassigned\|archived, `status`, `priority`, `tag` (id), `q`, `page`, `size` (≤100) | Paginated, newest activity first. `q` matches customer name, identifier, id. |
| POST   | `/`                | `customerId`, `applicationId?`, `customerName?`, `customerIdentifier?`, `subject?`, `priority?`                | 201 created; 200 when the open conversation for the application is reused.   |
| GET    | `/:id`             |                                                                                                                | Detail + `permissions` + `unreadCount`.                                      |
| GET    | `/:id/activities`  | `page`, `size`                                                                                                 | Status, assignment and archive history.                                      |
| PATCH  | `/:id/status`      | `{ status: OPEN\|RESOLVED\|CLOSED }`                                                                           | Resolve/close need owner or supervisor; reopen any viewer. 409 if unchanged. |
| POST   | `/:id/archive`     |                                                                                                                | Owner, supervisor, or anyone when unassigned.                                |
| POST   | `/:id/restore`     |                                                                                                                |                                                                              |
| POST   | `/:id/assign`      | `{ agentId?, note? }`                                                                                          | No `agentId` = take over. Assigning others: supervisor only.                 |
| POST   | `/:id/transfer`    | `{ agentId, note? }`                                                                                           | Owner or supervisor.                                                         |
| POST   | `/:id/unassign`    | `{ note? }`                                                                                                    | Back to the shared queue. Owner or supervisor.                               |
| GET    | `/:id/assignments` |                                                                                                                | Full assignment history, newest first.                                       |

Errors: `400` validation (`error.details` lists zod issues), `401` missing/invalid token, `403` role or permission,
`404` missing or hidden, `409` already in that state or lost a race (two agents claiming at once: one gets 409).

Example: `POST /api/conversations/12/assign` with `{}` as agent 1 →

```json
{
  "status": "success",
  "data": {
    "id": "5",
    "conversationId": "12",
    "agentId": "1",
    "assignedBy": "1",
    "type": "OWNER",
    "action": "TAKEOVER",
    "note": null,
    "assignedAt": "2026-11-05T04:00:00.000Z",
    "endedAt": null,
    "endedBy": null
  }
}
```
