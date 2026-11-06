# Internal notes and escalation API (FR-19)

Staff-only notes on a conversation, agent mentions with notifications, and escalation to a supervisor. Routes are under
`/api/v1/admin` and need a dashboard bearer token (customers get 403). Interactive reference:
`GET /api/v1/admin/openapi.json`. Envelope: `{ "status": "success", "data": ... }`.

## Privacy: notes are never customer-visible

Notes live in their own table (`internal_notes`), not in `messages`. So message history, sync, previews, unread counts
and the shared-media list can never contain one, and the future customer channel has nothing to filter. The timeline
entry a note creates (`NOTE_ADDED`) carries only the note id, never its text. Anyone who may see the conversation
(`canView`, supervisors included) can read its notes; anyone else gets `404`, as for the conversation itself.

## Notes

| Method and path                 | Body                                                | Who                                                               |
| ------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------- |
| `GET /conversations/:id/notes`  | query `page`, `size`                                | Anyone who can see the conversation. Newest first.                |
| `POST /conversations/:id/notes` | `{ text (1 to 4000), mentionedAgentIds? (max 10) }` | Anyone who can see the conversation. 201.                         |
| `PATCH /notes/:noteId`          | `{ text?, mentionedAgentIds? }` (one of them)       | The **author** only; supervisors cannot rewrite others' notes.    |
| `DELETE /notes/:noteId`         |                                                     | The author, or a supervisor/admin. Soft delete (the row is kept). |

A note looks like:

```json
{
  "id": "…",
  "conversationId": "…",
  "authorAgentId": "…",
  "author": { "id": "…", "name": "Sarah Chen", "avatarUrl": null },
  "content": "Customer prefers calls after 5pm",
  "mentionedAgentIds": ["…"],
  "isEdited": false,
  "createdAt": "…",
  "updatedAt": "…",
  "permissions": { "canEdit": true, "canDelete": true }
}
```

`author` comes from Backend 1 and is `null` if it cannot be reached. `permissions` are for the caller.

### Mentions

Mentions are **explicit ids** (`mentionedAgentIds`); the server does not parse `@names` from the text, because it cannot
resolve names without a Backend 1 lookup. On create, and on edit for agents newly added:

1. Each id must exist in Backend 1 and must be able to open the conversation, otherwise `400` with
   `error.details.agentIds` listing them and nothing is stored. A notification about a chat the agent cannot see would
   leak it. Agents are checked as plain agents, so a supervisor who is not on the chat cannot be mentioned yet (Backend 1's
   role data is not known).
2. Mentioning yourself is ignored; duplicates collapse.
3. Each mentioned agent gets a stored `MENTION` notification (`notification.new`, respecting their "mentions"
   preference) and a `note.mentioned` event. Editing a note never re-notifies agents who were already mentioned.
4. If Backend 1 cannot be reached while checking mentions the call fails with `503` instead of skipping the check.

## Escalation

| Method and path                       | Body                                | Who                                                                                                |
| ------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------- |
| `POST /conversations/:id/escalations` | `{ reason? (max 2000) }`            | The **owner** of a conversation that is not closed. 201. 409 if one is already pending.            |
| `GET /conversations/:id/escalations`  |                                     | Anyone who can see the conversation. Full history, newest first.                                   |
| `PATCH /escalations/:escalationId`    | `{ status: RESOLVED \| CANCELLED }` | `RESOLVED`: supervisors/admins. `CANCELLED`: the requester or a supervisor. 409 if already closed. |

The close endpoint is an addition to the suggested list: the schema allows one pending escalation per conversation, so
without it an escalation could never be answered. Escalating **only records the request**: it does not change the
owner, status, priority or handoff. A supervisor acts with the normal assignment endpoints. The one-pending rule is
enforced by the database (`ON CONFLICT … DO NOTHING` on the partial unique index), so simultaneous requests produce one
`201` and `409`s.

Each request and each outcome adds an `ESCALATED` entry to `GET /conversations/:id/activities` (`metadata`:
`escalationId`, `action` = `requested`, `resolved` or `cancelled`).

**Not built:** persistent notifications to supervisors. They would need Backend 1 to list who the supervisors are.
Today supervisors learn of an escalation from the live `conversation.escalated` event and from the history endpoint.

## WebSocket events (server to client)

Common to all: **Sender** the server, after the change committed. **Authentication** the `/ws` first-frame token.
**Acknowledgment** none (not client-sent). **Error handling** a failed publish is logged and never fails the REST call;
clients re-read over REST on reconnect.

| Event                    | Target                                             | Payload                                                         | Server-side logic                                                       |
| ------------------------ | -------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `note.created`           | Everyone who can see the conversation (per socket) | `{ note }` (without `permissions`)                              | After `POST /notes`. Receivers work out their own edit/delete rights.   |
| `note.updated`           | same                                               | `{ note }`                                                      | After an edit.                                                          |
| `note.deleted`           | same                                               | `{ id, conversationId }`                                        | After a delete.                                                         |
| `note.mentioned`         | Only the mentioned agent, on all of their sessions | `{ noteId, conversationId, mentionedBy, preview }`              | For each newly mentioned agent. Sent in addition to `notification.new`. |
| `conversation.escalated` | Everyone who can see the conversation              | `{ escalation }` (`status`: `PENDING`, `RESOLVED`, `CANCELLED`) | After an escalation was requested, resolved or cancelled.               |

The dashboard turns `note.*` into its own `NoteDto` and shows a toast for `conversation.escalated` only; it ignores
`note.mentioned` because the `MENTION` notification already shows one.

## Frontend

`features/internal-notes` (the notes panel in the customer-details column, opened from the chat's "more" menu),
`features/escalate-conversation` (the "Escalate to supervisor" menu item, asks for an optional reason),
`shared/api/rest/notes.ts`. Both appear only against the real backend. The mention picker lists agents the dashboard
already knows (owners of loaded conversations) because there is no "list agents" call yet; the server rejects anyone
who cannot see the conversation and the panel shows why.

## Tests

Unit tests cover permissions, mention validation and notification rules, failure of notifications and realtime, and the
escalation state rules. `notes-api.integration.test.ts` runs the real app over HTTP against PostgreSQL: the note
lifecycle and permissions, that note text appears in no message, preview, detail or timeline response, hidden
conversations, customers and anonymous callers, mention notifications and preferences, five simultaneous escalations
(one wins), the resolve/cancel rules, and that escalating changes nothing else on the conversation.
