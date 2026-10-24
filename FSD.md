# Feature-Sliced Design guide

This project uses the following layer order, from highest to lowest:

`app → pages → widgets → features → entities → shared`

The `@/` alias maps to `src/`. For UI conventions (layout, components, accessibility) see [docs/DESIGN_PATTERNS.md](docs/DESIGN_PATTERNS.md).

## Layer responsibilities

| Layer | Responsibility | Chat dashboard examples |
| --- | --- | --- |
| **app** | Composition, global providers, startup wiring such as WebSocket event subscriptions | `App.tsx`, `providers/realtime.ts` |
| **pages** | Screen-level composition. Assemble widgets and features for a route or view; hold only view state (open panels, active sub-view) | `ChatPage`, `ApplicationsPage` |
| **widgets** | Substantial page sections that combine several features and entities | `chat-window`, `conversation-sidebar`, `customer-context`, `top-navbar`, `applications-workspace` |
| **features** | One user-facing action, with its state and UI | `send-message`, `take-over-conversation`, `request-callback`, `search-in-chat`, `share-files`, `select-conversation`, `message-settings` |
| **entities** | Domain concepts, their state, and presentational components | `conversation`, `message` |
| **shared** | Reusable UI, API clients, config and utilities with no product knowledge | `shared/ui`, `shared/api/ws`, `shared/config`, `shared/lib` |

## Slice structure

Each slice (a folder under `widgets`, `features` or `entities`) uses these segments, creating only the ones it needs:

```
features/send-message/
├── index.ts          # public API: the only file other slices import
├── model/            # Zustand store, actions, selectors (+ *.test.ts)
└── ui/               # React components
```

- `entities`: `model/` holds the store and selector hooks; `ui/` holds components that only render the entity (`MessageBubble`).
- `features`: `model/` holds the actions, including WebSocket sends (`sendMessage`, `retryMessage`, `selectConversation`). Components call these functions; they do not call `wsClient` themselves.
- `widgets`: usually only `ui/`; state lives in the features and entities they compose.
- `shared`: organized by purpose (`ui`, `api`, `config`, `lib`), not by slice.

## Import rules

1. A layer may import from layers below it in this list. It must not import from a higher layer.
2. Code in one segment may use its own internal files. Imports from another segment in the same layer should go through that segment's `index.ts` public API.
3. Keep WebSocket connection/protocol code in `shared/api/ws`. Keep app-specific event routing into entity stores in `app`.
4. Put UI in `shared/ui` only when it is reusable across unrelated features; otherwise keep it with its owning feature or widget.
5. Add exports to a segment's `index.ts` when another segment needs to use its functionality. Avoid reaching into another segment's `model`, `ui`, or other internals.
6. Features must not import other features. If two features need the same logic, compose them in a widget or page, or move the shared part down into an entity or `shared`.

```ts
// ✅ public API of another slice
import { sendMessage } from "@/features/send-message";
// ❌ internals of another slice
import { sendMessage } from "@/features/send-message/model/store";
// ❌ a lower layer reaching up
import { ChatWindow } from "@/widgets/chat-window"; // inside an entity
```

## Where does new code go?

| You are adding… | Put it in… |
| --- | --- |
| A new button or action the agent performs (retry, archive, assign) | a `features/<verb-noun>` slice; export its action and UI from `index.ts` |
| A field on conversations or messages, or a selector over them | the matching `entities/*/model` |
| A panel or section that combines several features | a `widgets/*` slice, composed in a page |
| A new screen | `pages/<name>`, wired in `app/App.tsx` |
| A new server event | the type in `shared/api/ws/protocol.ts`, the routing in `app/providers/realtime.ts`, and the mock handler in `shared/api/ws/mock` |
| A generic helper or component used by unrelated features | `shared/lib` or `shared/ui` |

## Testing

- Co-locate tests with the code (`store.test.ts` next to `store.ts`).
- Test stores and actions, not markup. Mock the socket with `vi.mock("@/shared/api/ws", () => ({ wsClient: { send } }))` and assert on `send` calls and store state.
- Reset store state in `beforeEach` with `useXStore.setState({...})`.

## Enforcement

Run `pnpm check:fsd` to check layer direction and cross-segment imports. It reads relative and `@/` imports only, so it cannot see dynamic `import()` calls or the "features must not import features" rule above; catch those in review. `pnpm check` runs the FSD check together with typecheck, lint, format and tests.
