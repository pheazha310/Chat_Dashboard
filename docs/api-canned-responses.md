# Canned responses API (FR-21)

Saved reply templates: personal ones for one agent, shared ones for everybody. Routes are under
`/api/v1/admin/canned-responses` and need a dashboard bearer token (customers get 403). Interactive reference:
`GET /api/v1/admin/openapi.json`. Envelope: `{ "status": "success", "data": ... }`.

**Selecting a template never sends anything.** The API only stores and returns text. The dashboard puts the chosen text
into the composer's draft (on a new line after anything already typed); the agent edits it and presses send, which is
the ordinary `message.send`. There is no "send template" endpoint by design.

## Scopes and who sees what

| Scope      | Visible to                 | Created by         | Edited and deactivated by |
| ---------- | -------------------------- | ------------------ | ------------------------- |
| `PERSONAL` | Its creator only           | Any agent          | Its creator               |
| `SHARED`   | Every dashboard user       | Supervisors/admins | Supervisors/admins        |
| `TEAM`     | Nobody (not available yet) | Nobody             | Nobody                    |

- Someone else's personal template is invisible to everyone else, **supervisors included**: lists omit it and direct
  access answers `404` (not `403`, so its existence is not revealed).
- A deactivated shared template is visible only to supervisors. A deactivated personal one only to its creator.
- The scope cannot be changed after creation, so a private template can never become public by an edit.
- **`TEAM` is in the database but unused.** The schema requires a team id for team templates, and who belongs to which
  team is Backend 1's knowledge, whose contract is not known. Accepting a client-supplied team id would let anyone read any
  team's templates. `SHARED` (organisation-wide) was added to the allowed scopes for this reason (migration
  `20261107000000_canned_response_shared_scope`). Team templates can be switched on once Backend 1 can answer "is this
  agent on that team".

## Endpoints

| Method and path                | Body / query                                                                               | Notes                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `GET /canned-responses`        | `q`, `scope` (PERSONAL or SHARED), `shortcut`, `includeInactive`, `page`, `size` (max 200) | Active templates you may see, by title.                             |
| `POST /canned-responses`       | `{ title, content, shortcut?, scope? }`                                                    | `scope` defaults to PERSONAL. SHARED needs a supervisor (403). 201. |
| `GET /canned-responses/:id`    |                                                                                            | 404 if hidden from you.                                             |
| `PATCH /canned-responses/:id`  | `{ title?, content?, shortcut? (null removes), isActive? }` (at least one)                 | 403 if you can see but not manage it (a shared one, as an agent).   |
| `DELETE /canned-responses/:id` |                                                                                            | **Deactivates** (never deletes). Repeating it is harmless.          |

A template:

```json
{
  "id": "…",
  "title": "Greeting",
  "content": "Hello, how can I help you today?",
  "shortcut": "/hi",
  "scope": "PERSONAL",
  "createdBy": "…",
  "isActive": true,
  "createdAt": "…",
  "updatedAt": "…",
  "permissions": { "canEdit": true }
}
```

Limits: title 1 to 255 characters, text 1 to 4000 (the same limit as a message, so any template can be sent), shortcut
`/` followed by 1 to 49 letters, digits, `_` or `-`.

### Search

`q` matches the title, the text and the shortcut, ignoring case. It matches the text you type literally: `%` and `_`
are not wildcards. `shortcut` finds one template by exactly what the agent typed (ignoring case), for resolving
`/greeting`. `scope` narrows to personal or shared.

### Shortcuts

A shortcut means one template to whoever can see it, so it must be unique among: the agent's own active personal
templates, and (separately, case-insensitively) all active shared templates. A personal and a shared template may use
the same shortcut. A clash answers `409`. This is a check for a clear message plus two partial unique indexes
(`canned_responses_personal_shortcut_key`, `canned_responses_shared_shortcut_key`) that settle simultaneous requests:
of several identical creates, one wins. Deactivating a template frees its shortcut; reactivating it checks again, and
fails with `409` if someone took the shortcut meanwhile (clear the shortcut in the same request to reactivate anyway).

## Errors

| Case                                                                  | Status   |
| --------------------------------------------------------------------- | -------- |
| No or invalid token; customer role                                    | 401, 403 |
| Invalid shortcut, blank or too long text, `scope: TEAM`, empty update | 400      |
| Creating or changing a shared template as an agent                    | 403      |
| Another agent's personal template, hidden shared one                  | 404      |
| Shortcut already used                                                 | 409      |

No WebSocket events: templates are fetched when the picker opens. Another window's changes show on the next open.

## Frontend

`features/canned-responses` provides the picker: a button in the composer opens a searchable list. Clicking an entry
calls `insertIntoDraft` (from `features/send-message`), which fills the draft; the agent edits and sends as usual. The
same popover creates, edits and deactivates the agent's own templates, and lets supervisors share a new one. The
widget `chat-window` connects the two features (features do not import each other). It appears only against the real
backend. Not built: expanding a typed `/shortcut` inside the text box (the API resolves shortcuts with `?shortcut=`, but
the composer does not call it yet), reactivating a deactivated template from the picker, and a screen to manage templates
outside the composer.

## Tests

Unit tests cover visibility and permission rules, the shortcut checks, and the schemas.
`canned-responses-api.integration.test.ts` runs the real app against PostgreSQL: personal templates hidden from other
agents and supervisors in lists, search and direct access, shared templates managed only by supervisors, search
(including `%` as literal text), deactivation and reactivation, shortcut uniqueness per agent and across shared ones, four
simultaneous creates of one shortcut (one wins), freed and re-checked shortcuts, validation, authentication, and the
database constraints on scope and team id. A deliberate break of the personal-visibility filter failed the tests.
