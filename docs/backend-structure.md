# Backend structure

`backend/src/` is organised by domain module. Each module keeps the layering from AGENTS.md
(`routes → controller → service → repository → Prisma`) in one folder.

```
backend/
├── prisma/
│   ├── schema/              schema.prisma (generator, datasource) + one file per domain: 01-identity-and-access … 11-moderation
│   ├── migrations/          append-only SQL migrations (path set in prisma.config.ts)
│   └── sql/constraints.sql  CHECKs and partial indexes Prisma cannot express (generated/ is git-ignored)
├── vitest.config.ts         aliases + coverage thresholds
└── src/
    ├── server.ts            http server, websocket attach, graceful shutdown
    ├── app.ts               express app: helmet, cors, request context, pino-http, json, /api/health, /api/v1/admin, notFound, errorHandler
    ├── routes.ts            mounts every module router (served under /api/v1/admin)
    ├── container.ts         builds every service once (composition root); app-container.ts is the running app's instance
    ├── config/              env.ts (zod-validated env), cors.ts, database.ts (Prisma singleton), redis.ts,
    │                        logger.ts (pino), request-context.ts (AsyncLocalStorage requestId)
    ├── modules/
    │   ├── health/          reference module
    │   ├── conversations/   inbox, detail, create, status changes, archive, activities
    │   ├── assignments/     assign (takeover), transfer, unassign, history
    │   ├── messages/        send (idempotent), history/sync cursors, read/unread, receipts, SYSTEM messages
    │   ├── presence/        agent availability (Redis live state + Postgres history), REST + used by the socket
    │   ├── realtime/        turns committed changes into audience-targeted events on the event bus (service only)
    │   ├── customers/       customer profile (redacted by role), other conversations, participants (Backend 1 via Directory)
    │   ├── notifications/   list, unread count, mark read, preferences, per-conversation mute; also creates notifications for other modules
    │   ├── auth/            sign-in, registration, refresh, password change (AuthService); admin account management (UserService);
    │   │                    access tokens, password hashing, the account check on every token
    │   ├── roles/           roles and their permissions (admin API)
    │   ├── chat-identity/   maps a verified token to its chat user and loads the role's permissions (service only)
    │   ├── profile/         `GET /me` for staff and customers
    │   ├── customer-channel/ the mobile app's `/api/v1/customer` endpoints (calls other modules' services)
    │   └── ...              one folder per domain, see the table below
    ├── scripts/             one-off CLI tasks run with tsx (create-admin.ts: first ADMIN account)
    ├── websocket/           server (transport, heartbeat), auth (first-frame token), handler (event → service),
    │                        events (zod schemas), rooms (per-socket audience filter), bus (Redis / in-memory)
    └── shared/
        ├── auth/            AuthClient/AuthContext types, permissions catalog + can(), MappedAuthClient (identity + permission
        │                    cache), DevAuthClient (dev/test only)
        ├── errors/          AppError.ts (AppError + subclasses)
        ├── middleware/      auth, validate (+ `parsed()`), error-handler, not-found, request-context
        ├── directory/       DevDirectory (dev/test stand-in for Backend 1), CachedDirectory (agent names), createDirectory
        ├── ports/           interfaces between modules and the outside: SystemMessagePort, RealtimeNotifier, Directory (Backend 1),
        │                    ConversationAccess, AvailableAgents
        ├── policy/          conversation-access.ts: who can view/do what (used by two modules, so shared)
        └── utils/           ids (UUID validation), pagination (page + cursor), best-effort (post-commit side effects)
```

Import with aliases (`@config/*`, `@modules/*`, `@shared/*`, `@lib/*`); `build` runs `tsc && tsc-alias` so they
resolve in `dist/`. Within a module use relative `./` imports. Services are classes that receive their repository
through the constructor; wiring happens in `<name>.routes.ts`.

## Module layout

```
modules/<plural>/                e.g. conversations/
├── <singular>.routes.ts           route definitions: wires middleware, validation, controller
├── <singular>.controller.ts       Express handlers: extract inputs, call service, return JSON
├── <singular>.service.ts          business logic and transactions; no req/res, no Prisma
├── <singular>.repository.ts       Prisma queries only, no business logic; only file importing `@config/database.js`
├── <singular>.schema.ts           zod schemas: source of truth for request shapes and inferred TS types
├── <singular>.openapi.ts          OpenAPI path registrations (see below)
├── <singular>.types.ts            interfaces and type aliases not derived from zod
└── index.ts                       public surface (service + types); other modules import only this
```

Folder names are plural, file prefixes singular (`health` has no plural, so it keeps one name).
Create `schema` and `types` files only when a module needs them; every module that exposes routes has an `openapi` file.

### OpenAPI

Each module's `<name>.openapi.ts` exports `register<Name>OpenApi(registry)`, which registers its paths with
`@asteasolutions/zod-to-openapi` (v9, zod 4), reusing the request schemas from `<name>.schema.ts`. Response schemas are
declared in the same file with `satisfies z.ZodType<SomeDto>`, so a DTO change that is not mirrored fails the build.
`src/openapi.ts` collects every module and `GET /api/v1/admin/openapi.json` serves the OpenAPI 3.1 document (public; no Swagger UI
is bundled, point any viewer at that URL). Shared helpers are in `shared/openapi/` (`registry.ts`, `envelopes.ts`).
When you add a route, register it in the module's `.openapi.ts` and add it to the route list in
`shared/openapi/__tests__/openapi.test.ts`, which fails if the two drift.

File purposes inside a module: `controller` (HTTP in/out), `service` (business logic, DTO shaping, no `req`/`res`, no
Prisma), `repository` (Prisma queries and the query builders they need), `routes`, `schema` (zod), `openapi`, `types`.
A module may also hold a helper file for one self-contained concern used only inside it, named
`<singular>.<concern>.ts` (`attachment.range.ts`, `callback.scheduler.ts`, `auth.tokens.ts`, `auth.password.ts`), or a
second service when the module owns two clearly separate jobs (`message-action.service.ts`, `user.service.ts`). Do not
add per-module `query` or `policy` files; rules shared by two modules go in `shared/`.

Rules: no `req`/`res` below controllers; a module never imports another module's repository; add a
`shared/<folder>` only when a second module needs it.

## Modules

Built (each has its API guide, listed in [AGENTS.md](../AGENTS.md)):

| Module                                                         | Owns                                                                                               | Guide                    |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------ |
| `conversations`                                                | Conversations, status, archive, priority, activity log, inbox filters and search                   | api-conversations.md     |
| `assignments`                                                  | Takeover, assign, transfer, unassign, assignment history                                           | api-conversations.md     |
| `messages`                                                     | Messages, receipts, unread; message actions (reply, edit, delete, reactions, forward)              | api-message-actions.md   |
| `attachments`                                                  | Files, images, voice messages, secured downloads (`Storage` port, local-disk driver)               | api-attachments.md       |
| `notes`                                                        | Internal notes and agent mentions                                                                  | api-notes-escalations.md |
| `escalations`                                                  | Escalation to a supervisor                                                                         | api-notes-escalations.md |
| `tags`                                                         | Tag catalog and tagging of conversations                                                           | api-tags-priority.md     |
| `canned-responses`                                             | Personal and shared reply templates                                                                | api-canned-responses.md  |
| `workspace`                                                    | Per-agent open tabs, drafts, tab preferences                                                       | api-workspace.md         |
| `chat-settings`                                                | Per-agent chat switches                                                                            | api-chat-settings.md     |
| `callbacks`                                                    | Scheduled callbacks and the reminder job                                                           | api-callbacks.md         |
| `calls`                                                        | Call records and WebRTC signalling relay                                                           | api-calls.md             |
| `moderation`                                                   | Blocked customers, blocked keywords, spam reports, audit log                                       | api-moderation.md        |
| `auth`                                                         | Accounts, sign-in, refresh sessions, password changes, admin account management                    | api-auth.md              |
| `roles`                                                        | Roles and which permissions each has                                                               | api-roles.md             |
| `customer-channel`, `profile`                                  | The mobile app's REST API; the signed-in user's own profile                                        | api-customer-mobile.md   |
| `chat-identity`                                                | Token identity → chat user, role permissions (no routes)                                           | api-auth.md              |
| `notifications`, `presence`, `customers`, `realtime`, `health` | Notifications, presence and typing, customer info via the `Directory` port, the realtime publisher | api-conversations.md     |

Modules call each other only through services or the ports in `shared/ports/` (`ConversationAccess`,
`CustomerConversationAccess`, `ConversationSummaries`, `RealtimeNotifier`, `Directory`, `CustomerGuard`, `MessageLookup`,
`Storage`, `SystemMessagePort`). Two kinds of background job run inside the API process, started only by `server.ts`: the
callback job (`CallbackScheduler`) and the call job (`IntervalJob`); both claim rows in the database, so several instances
can run them.

Still to build: push notifications, the AI worker and handoff (`AiHandoff` models were removed from the schema until
designed), automations and analytics. Automations and analytics have **no schema or design yet**: propose them and
update the schema, protocol and docs first.

Authentication is owned here (`auth` module): `app-container.ts` chains `AccessTokens` (JWT) → `AccountCheckedAuthClient`
(disabled or changed-role accounts refused) → `MappedAuthClient` (chat identity + permissions), with `DevAuthClient`
accepted alongside only when `AUTH_MODE=dev`. REST middleware and the WebSocket gateway share that one `authClient`.

## Websocket

`src/websocket/` is the gateway. It has no business rules: `websocket.handler.ts` validates a frame with the same zod
schemas as REST and calls the same services; services report committed changes to `RealtimeService`, which publishes
audience-targeted events to the `EventBus`; `websocket.rooms.ts` delivers each event only to the sockets that pass the
shared `canView` rule. The contract is in [websocket-events.md](websocket-events.md).

`container.ts` exists because REST and the gateway must share one set of service instances (and the realtime/service
cycle needs a single place to be tied). Modules never import it; only `*.routes.ts` (through `app-container.ts`) and the
gateway do. Wiring a new service means adding it there.
