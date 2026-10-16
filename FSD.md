# Feature-Sliced Design guide

This project uses the following layer order, from highest to lowest:

`app → pages → widgets → features → entities → shared`

## Layer responsibilities

- **app**: application composition, global providers, routing, and startup wiring such as WebSocket event subscriptions.
- **pages**: screen-level composition. Pages assemble widgets and features for a route or view.
- **widgets**: substantial page sections such as the conversation sidebar and chat window.
- **features**: user-facing actions such as sending a message, taking over a conversation, or requesting a callback.
- **entities**: domain concepts and their state, such as conversations and messages.
- **shared**: reusable UI, API clients, configuration, and utilities with no dependency on product-specific layers.

## Import rules

1. A layer may import from layers below it in this list. It must not import from a higher layer.
2. Code in one segment may use its own internal files. Imports from another segment in the same layer should go through that segment's `index.ts` public API.
3. Keep WebSocket connection/protocol code in `shared/api/ws`. Keep app-specific event routing into entity stores in `app`.
4. Put UI in `shared/ui` only when it is reusable across unrelated features; otherwise keep it with its owning feature or widget.
5. Add exports to a segment's `index.ts` when another segment needs to use its functionality. Avoid reaching into another segment's `model`, `ui`, or other internals.

Run `pnpm check:fsd` to check layer direction and cross-segment imports.
