# Roles and permissions API

What each role may do is data. There are four fixed roles (`CUSTOMER`, `AGENT`, `SUPERVISOR`, `ADMIN`: access tokens
and `users.role` carry the name) and a catalogue of permissions named `module.action`. Admins choose which permissions
each staff role has. Staff routes, under `/api/v1/admin`, with the usual envelope (`docs/api-auth.md`).

## How checks work

- Services check `can(auth, "module.action")`. The permissions come with the signed-in identity (`chat_users.role_id` →
  `role_permissions`) and are cached with it for 60 s, so **a change applies to signed-in users within a minute**.
- Permissions extend what someone may do to **everyone else's** things. Ownership rules stay in code: an agent can
  always delete their own messages and notes, edit their own tags, manage callbacks assigned to or created by them, and
  work the conversations they own. Taking over a waiting conversation needs no permission.
- The catalogue is defined in `backend/src/shared/auth/permissions.ts` and seeded by migrations (a test keeps them
  identical). Adding a permission means adding it there and in a migration; it is not created at runtime.

## Permissions and default grants

The migration grants every permission below to `SUPERVISOR` and `ADMIN`, except `users.manage` and `roles.manage`
(`ADMIN` only). `AGENT` and `CUSTOMER` start with none. These defaults reproduce the rules from before permissions
were data.

| Permission                       | Allows                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------- |
| `conversations.view_all`         | See and open every conversation, including ones assigned to other agents              |
| `conversations.manage_all`       | Take over, assign, transfer, unassign, resolve, close and archive any conversation    |
| `customers.view_contact`         | See a customer's contact details in any conversation, not only one's own              |
| `customers.view_sensitive`       | See a customer's sensitive loan data (national id, salary, occupation, blacklist)     |
| `messages.delete_any`            | Delete any agent's or customer's message                                              |
| `messages.view_history_any`      | See the edit history of any message, and deleted messages                             |
| `attachments.delete_any`         | Delete any uploaded file                                                              |
| `notes.delete_any`               | Delete any internal note                                                              |
| `tags.edit_any`                  | Rename or recolour any tag                                                            |
| `tags.delete`                    | Delete tags                                                                           |
| `canned_responses.manage_shared` | Create, edit and delete shared reply templates, and see inactive ones                 |
| `callbacks.view_all`             | List and open everyone's callbacks                                                    |
| `callbacks.manage_all`           | Edit, complete and cancel any callback                                                |
| `calls.answer_any`               | Answer customer calls in conversations owned by another agent                         |
| `calls.end_any`                  | End any active call, even without having joined it                                    |
| `escalations.resolve`            | Resolve escalations                                                                   |
| `escalations.manage_all`         | Cancel escalations raised by others                                                   |
| `moderation.block_any`           | Block customers directly or from any conversation, see every block and lift any block |
| `moderation.manage_keywords`     | Manage blocked keywords                                                               |
| `moderation.review_reports`      | See every spam report and review them                                                 |
| `moderation.view_log`            | Read the moderation log                                                               |
| `users.read`                     | View staff and customer accounts                                                      |
| `users.manage`                   | Create staff accounts, change roles and status, reset passwords                       |
| `roles.read`                     | View roles and their permissions                                                      |
| `roles.manage`                   | Change which permissions each role has                                                |

## Endpoints

| Method and path                  | Needs          | Body              | Notes                                                                               |
| -------------------------------- | -------------- | ----------------- | ----------------------------------------------------------------------------------- |
| `GET /roles`                     | `roles.read`   |                   | `[{ id, name, kind, description, permissions: ["tags.delete", …] }]`                |
| `GET /permissions`               | `roles.read`   |                   | The catalogue: `[{ name, module, action, description }]`                            |
| `PUT /roles/:roleId/permissions` | `roles.manage` | `{ permissions }` | Replaces the whole set; returns the role. `400` for an unknown name or a rule below |

Rules for `PUT`:

- `ADMIN` always keeps `users.manage` and `roles.manage` (`400`), so nobody can lock everyone out.
- `CUSTOMER` roles cannot have permissions (`400`): every permission is a staff one.
- Roles cannot be created, renamed or deleted: their names are carried in access tokens.

```json
// PUT /api/v1/admin/roles/2/permissions
{ "permissions": ["conversations.view_all", "tags.delete"] }
```

## Data

`roles`, `permissions`, `role_permissions` and `chat_users.role_id` (migration `20261112000000_roles_permissions`;
`docs/database-schema.md`). The same migration links `conversations.customer_id`, `messages.sender_id` and
`attachments.uploaded_by_id` to `chat_users`.

## Not built yet

- No dashboard screen for roles; use the API (Postman: _Auth and accounts_).
- `chat_users.los_user_id` (the person's id in the loan system) is a column only, until the LOS contract is known.
