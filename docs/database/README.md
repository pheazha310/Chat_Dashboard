# Database schema (DBML)

One small DBML file per domain of the chat database. These files are the source of truth for tables, columns, indexes
and relations; [../database-schema.md](../database-schema.md) explains the rules behind them.

| File                                                                     | Tables                                                                                                                      |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| [00-overview.dbml](00-overview.dbml)                                     | Project settings, how to read the files, how to add a table                                                                 |
| [01-identity-and-access.dbml](01-identity-and-access.dbml)               | `users`, `staff`, `customers`, `refresh_tokens`, `roles`, `permissions`, `role_permissions`, `chat_users`                   |
| [02-conversations.dbml](02-conversations.dbml)                           | `conversations` (the hub), `conversation_participants`, `conversation_assignments`, `conversation_activities`               |
| [03-messages.dbml](03-messages.dbml)                                     | `messages`, `message_receipts`, `conversation_reads`, `message_edit_history`, `message_reactions`                           |
| [04-attachments.dbml](04-attachments.dbml)                               | `attachments`, `message_attachments`                                                                                        |
| [05-notes-and-escalations.dbml](05-notes-and-escalations.dbml)           | `internal_notes`, `note_mentions`, `conversation_escalations`                                                               |
| [06-tags.dbml](06-tags.dbml)                                             | `tags`, `conversation_tags`                                                                                                 |
| [07-notifications-and-presence.dbml](07-notifications-and-presence.dbml) | `notifications`, `notification_preferences`, `conversation_notification_settings`, `push_devices`, `agent_presence_history` |
| [08-agent-workspace.dbml](08-agent-workspace.dbml)                       | `workspace_preferences`, `workspace_open_conversations`, `conversation_drafts`, `user_chat_settings`                        |
| [09-replies-and-automation.dbml](09-replies-and-automation.dbml)         | `canned_responses`, `automation_rules`, `automation_logs`                                                                   |
| [10-callbacks-and-calls.dbml](10-callbacks-and-calls.dbml)               | `callback_requests`, `calls`, `call_participants`                                                                           |
| [11-moderation.dbml](11-moderation.dbml)                                 | `spam_reports`, `customer_blocks`, `blocked_keywords`, `moderation_activities`                                              |
| [12-backend-1-external.dbml](12-backend-1-external.dbml)                 | `los_customers`, `los_agents`, `loan_applications`: Backend 1, context only, not created here                               |

Each file has the same layout: a header saying what the domain is for, its `TableGroup`, its tables, and then the
relations that start in those tables. The Prisma models live in the file with the same number in
[backend/prisma/schema/](../../backend/prisma/schema/).

## Working with the files

- **Edit** the file of the domain you are changing. Relations may point at tables in other files (most point at
  `conversations` in 02), so a single file does not parse on its own.
- **Rebuild** the one-file copy with `pnpm db:dbml`. It joins the files in name order into
  [../database-schema.dbml](../database-schema.dbml), which you can paste into https://dbdiagram.io/d. Never edit that
  copy: `backend/src/__tests__/docs-consistency.test.ts` fails when it is out of date.
- **Add a table** to its domain file, list it in the `TableGroup`, give it the group's `headercolor` and put its `Ref`s
  below it. For a new domain, add a numbered file and keep Backend 1 last. Then change the Prisma file through a
  migration (see [00-overview.dbml](00-overview.dbml)).
