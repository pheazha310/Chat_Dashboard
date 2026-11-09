# Tags and conversation priority API (FR-20)

A shared list of tags that agents attach to conversations, and a priority (HIGH, MEDIUM, LOW) per conversation, with
filtering and sorting in the inbox. Routes are under `/api/v1/admin` and need a dashboard bearer token (customers get
403). Interactive reference: `GET /api/v1/admin/openapi.json`. Envelope: `{ "status": "success", "data": ... }`.

## Tags

| Method and path       | Body / query                                | Who                                                            |
| --------------------- | ------------------------------------------- | -------------------------------------------------------------- |
| `GET /tags`           | `q` (name search), `page`, `size` (max 200) | Any agent. Alphabetical, each with `usageCount`.               |
| `POST /tags`          | `{ name (1 to 100), color? ("#RRGGBB") }`   | Any agent. 201. 409 if the name exists in any letter case.     |
| `PATCH /tags/:tagId`  | `{ name?, color? (null clears) }`           | The tag's creator, or a supervisor/admin. 409 on a name clash. |
| `DELETE /tags/:tagId` | query `force` (`true` or `1`)               | Supervisors/admins only.                                       |

Names are unique ignoring case. This is enforced twice: a check for a clear message, and the database index
`tags_name_lower_key`, which also settles simultaneous creates (one `201`, the rest `409`).

### Deleting a tag that is in use

Without `force`, a tag used by any conversation is **refused with 409**, and `error.details.usageCount` says how many.
With `force=true`, in one transaction the tag is recorded as removed on each conversation (`TAG_REMOVED` timeline entry),
and deleted; its links to conversations go with it. Afterwards every affected conversation receives
`conversation.tags_updated`. The response is `{ id, removedFromConversations }`. Renaming or recoloring a tag sends the
same event to the conversations that use it, so open screens do not show the old name.

## Tagging a conversation

`PUT /conversations/:id/tags` with `{ tagIds: [...] }` makes the conversation's tags **exactly** that set (at most 20; an
empty list removes all). It returns `{ conversationId, tags: [{ id, name, color }] }`.

- **Who:** `permissions.canOrganize`: the owner, a supervisor/admin, or anyone while nobody owns the conversation.
  Another agent who can see it (for example a viewer) gets `403`; one who cannot see it gets `404`.
- Unknown ids give `400` with `error.details.tagIds`. Duplicates in the request collapse.
- The difference is applied under a row lock on the conversation, so simultaneous requests run one after the other and
  never leave duplicates or a half-applied set. Sending the current set changes nothing and writes nothing.
- Each addition and removal adds a `TAG_ADDED` / `TAG_REMOVED` entry to `GET /conversations/:id/activities`
  (`metadata`: `tagId`, `tagName`), and `conversation.tags_updated` is broadcast.

`tags` is also part of every conversation in lists, details and events.

## Priority

`PATCH /conversations/:id/priority` with `{ priority: "HIGH" | "MEDIUM" | "LOW" }`. New conversations start at `MEDIUM`.

- **Who:** `permissions.canOrganize`, as for tags.
- Setting the value it already has returns the conversation and writes nothing.
- The change is a conditional update on the value the request saw, so two simultaneous changes cannot both win: the
  other gets `409`. It adds a `PRIORITY_CHANGED` entry (`metadata`: `from`, `to`) and broadcasts
  `conversation.priority_changed`. The database also refuses any value other than the three (CHECK constraint).

## Filtering and sorting the inbox

`GET /conversations` accepts, in addition to the existing filters:

| Query      | Meaning                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------- |
| `priority` | `HIGH`, `MEDIUM` or `LOW`.                                                                                    |
| `tag`      | One tag id.                                                                                                   |
| `tags`     | Comma-separated tag ids (at most 10). Combined with `tag`.                                                    |
| `tagMatch` | `any` (default): has at least one of the tags. `all`: has every one.                                          |
| `sort`     | `recent` (default): latest activity first. `priority`: HIGH, then MEDIUM, then LOW, latest first inside each. |

All filters combine with each other, with `filter` (all, mine, unread, ...), `status` and `q`, and `total` always counts the
whole filtered set, so paging through a priority-sorted list shows each conversation exactly once. The priority names do not
sort alphabetically in that order, so the three groups are paged one after the other instead of sorting on the column.

## WebSocket events (server to client)

Common to both: **Sender** the server, after the change committed. **Authentication** the `/ws` first-frame token.
**Authorization** delivered per socket to whoever may see the conversation (`canView`). **Acknowledgment** none. **Error
handling** a failed publish is logged and never fails the REST call; clients re-read the conversation on reconnect.

| Event                           | Payload                                                                  | Server-side logic                                     |
| ------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------- |
| `conversation.priority_changed` | `{ conversationId, from, to, conversation }`                             | After a priority change.                              |
| `conversation.tags_updated`     | `{ conversationId, conversation }` (`conversation.tags` is the new list) | After tags were set, or a tag was renamed or deleted. |

`conversation` is the usual event DTO (no per-agent unread count). The dashboard folds both into its existing
conversation update.

## Frontend

`features/organize-conversation` is the "Priority & tags" panel (more menu, details column): radio buttons for the
priority, checkboxes for every tag, and a field to create one. The inbox sidebar has priority, tag and sort selectors
(only against the real backend). Filtering and sorting there are applied to the conversations already loaded (the first
100 from `sync`); for the full set the API query parameters above are available. Tag renaming, recoloring and deletion
have REST endpoints but no screen yet.

## Tests

Unit tests cover the tag rules (creator and supervisor rights, name clashes, the in-use delete rules, diffing a tag set)
and the priority rules. `tags-api.integration.test.ts` runs the real app against PostgreSQL: tag CRUD and search,
case-insensitive uniqueness under concurrent creates, tagging with timeline entries, permissions (owner, supervisor,
unowned, viewer, hidden, customer), simultaneous tag changes, refusing and forcing a delete, priority changes and the
database constraint, filtering by priority and by one, any or all tags, and priority sorting across page boundaries.
