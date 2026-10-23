# Chat Dashboard — UI/UX Design Patterns

This document defines the consistent design patterns for the Chat Dashboard. It captures and formalizes conventions observed across the codebase so that new features stay aligned with the existing product.

## 1. Architecture & Structure

### Feature-Sliced Design (FSD)

Layers (import direction: `app → pages → widgets → features → entities → shared`):

| Layer | Responsibility | Example |
|-------|---------------|---------|
| **app** | Root composition, global providers, startup wiring | `App.tsx`, `providers/realtime.ts` |
| **pages** | Screen-level assembly of widgets + features | `ChatPage`, `ApplicationsPage` |
| **widgets** | Substantial page sections (multi-feature composition) | `ChatWindow`, `ConversationSidebar`, `TopNavbar` |
| **features** | User-facing actions/behaviors | `send-message`, `take-over-conversation`, `search-in-chat` |
| **entities** | Domain concepts + state | `conversation`, `message` |
| **shared** | Reusable UI, API, config, utilities | `shared/ui`, `shared/api`, `shared/config` |

**Import rules:**
- A layer may only import from itself and layers below it.
- Same-layer cross-segment imports go through the segment's `index.ts` (public API barrel).
- UI components live in `shared/ui` **only** when reused across unrelated features.
- WebSocket connection/protocol code stays in `shared/api/ws`; app-specific event routing lives in `app`.

**State management:** Zustand stores are used at every level. Each store co-locates with its feature/entity. Selectors are preferred over full-state subscriptions to minimize re-renders.

---

## 2. Layout Patterns

### 2.1 Root Container

```html
<main class="lending-crm">
  <header class="top-navbar" />       <!-- 72px fixed -->
  <div class="workspace" />           <!-- grid, fills remaining viewport -->
</main>
```

- `.lending-crm`: `height: 100vh`, `min-height: 720px`, `overflow: hidden`, background `#f4f5f7`.
- `.top-navbar`: `72px` height, `backdrop-filter: blur(10px)`, semi-transparent white background, `border-bottom: 1px solid #e7e9ee`.
- `.workspace`: `height: calc(100vh - 72px)`, CSS grid with three columns.

### 2.2 Three-Column Workspace (Chat Page)

```
Conversation Sidebar  |  Chat Window  |  Customer Context
```

Grid definition:
```css
grid-template-columns: minmax(310px, 1fr) minmax(480px, 1.5fr) minmax(350px, 1.25fr);
```

**Column behaviors:**
- **Conversation Sidebar** (`.message-sidebar`): scrollable conversation list. On narrow screens becomes a fixed drawer (slide-in from left with transform + `.panel-open` class).
- **Chat Window** (`.active-chat`): the primary conversation view. Always visible; collapses to empty section when no conversation is selected.
- **Customer Context** (`.context-column`): right-side contextual panel. On narrow screens becomes a fixed drawer (slide-in from right). When a detail sub-view is active, gains `.has-detail` class — collapses the overview and shows `.context-detail-panel`.

### 2.3 Two-Column Workspace (Applications Page)

```
Navigation  |  Applications Workspace
```

Grid definition:
```css
grid-template-columns: 256px 1fr;
```

- `.applications-nav`: 256px pinned sidebar with logo + collapsible nav tree.
- `.applications-workspace`: main content area with topbar → title → status tabs → data table.

### 2.4 Drawer / Panel Pattern

Used for mobile sidebars and detail views. Core elements:

```tsx
// Trigger opens panel
<aside className={`message-sidebar ${open ? "panel-open" : ""}`}>
  ...
</aside>
// Backdrop overlay (when any panel is open)
<button className="mobile-overlay" onClick={closeAll} aria-label="Close panel" />
```

**CSS contract:**
- Panel starts off-canvas with `transform: translateX(calc(-100% - 20px))` (left) or `translateX(calc(100% + 30px))` (right).
- `.panel-open` resets transform to `translateX(0)`.
- Transition: `transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)`.
- Backdrop: `position: fixed; z-index: 30; inset: 72px 0 0; background: rgba(17, 24, 39, 0.25); backdrop-filter: blur(2px)`.

### 2.5 Modal / Overlay Pattern

Used for dialogs (e.g., Message Settings).

```tsx
<div className="settings-overlay" role="presentation"
     onMouseDown={(e) => e.target === e.currentTarget && close()}>
  <section className="message-settings" role="dialog" aria-modal="true" aria-labelledby="...">
    ...
  </section>
</div>
```

- Overlay: `position: fixed; inset: 0; z-index: 70; background: rgba(17, 24, 39, 0.28); backdrop-filter: blur(3px)`.
- Dialog: centered via `display: grid; place-items: center`, with `max-height` constraint and internal scroll.
- **Close triggers:** click-outside, Escape key, dedicated close button.

### 2.6 Floating Window Pattern (Expanded Chat)

A draggable, resizable floating chat window (`.expanded-chat`).

- `position: fixed`, high `z-index: 10`, anchored to bottom-right (`right: 7%`).
- **Header drag:** `onPointerDown` / `onPointerMove` / `onPointerUp` on the header element sets `cursor: grab` / `cursor: grabbing`. Ignores clicks that originate on interactive elements (buttons, inputs).
- **Resize handles:** 8 `<span>` elements positioned on each edge/corner, each with `data-edge`. Resize uses `requestAnimationFrame` batching to avoid layout thrashing. Enforces `minWidth: 320px`, `minHeight: 300px`, and window-bounds clamping.

### 2.7 Compose FAB Pattern

A circular floating action button (`.compose-fab`) positioned fixed at `right: 28px; bottom: 28px` (moves to `16px` on mobile). Used as a persistent entry point to open the chat.

---

## 3. Component Patterns

### 3.1 Icon Button (`IconButton`)

```tsx
<IconButton icon={assets.icons.search} size={24} label="Search conversation" onClick={handler} />
```

- Always requires a `label` prop (used for `aria-label` and `title`).
- Renders a `<button type="button">` wrapping an `AssetIcon`.
- Accepts optional `className` for contextual styling (e.g., `"circle-action"`, `"expanded-back"`).
- Decorative icons: `alt=""` on the underlying `<img>`.

### 3.2 Asset Icon (`AssetIcon`)

```tsx
<AssetIcon src={assets.icons.mic} size={18} />
```

- Simple `<img>` wrapper with `className="asset-icon"`, `object-fit: contain`.
- `size` defaults to `20` (both width and height).
- Used for all iconography sourced from `assets.*`.

### 3.3 List Item Pattern

**Conversation items** (`ConversationItem`, `.conversation-item`):
- `<button>` with `flex` layout, `gap: 12px`, `border-radius: 16px`, `padding: 12px`.
- Avatar (44×44, circular), content area (flex-1, truncates with `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`), optional unread badge.
- `.selected` state: solid blue background `#2563eb`, white text, inverted unread badge (white bg, blue text).
- Hover: `background: #f8fafc`.

**Table rows** (`ApplicationsTable`):
- `<tr>` with fixed-height cells (`49px` for header, auto for body).
- Status badges use `.application-status` with semantic color classes (`.new`, `.reviewing`, `.completed`, `.failed`, `.paid-off`).
- Row action buttons grouped in `.row-actions` with consistent `IconButton` sizing.

### 3.4 Message Bubble Pattern

```tsx
<div className={`message-block ${side} ${status === "failed" ? "failed" : ""}`}>
  <div className="message-line">
    <div className="message-bubble">...</div>
    {avatar}
  </div>
  <time>{caption}</time>
</div>
```

- **Alignment:** `customer` messages align left (`align-items: flex-start`), `agent`/`assistant` messages align right (`align-items: flex-end`).
- **Styling:** rounded speech-bubble shape (`16px 16px 16px 4px` for agent, `4px 16px 16px` for customer). Distinct background colors per side.
- **Sender label:** `assistant` shows "AI ASSISTANT", `agent` shows "SUPPORT AGENT" — uppercase, `#722ed1` / `#2563eb` respectively, `font-size: 11px`.
- **Status line:** `formatClock(message.createdAt)` + optional delivery status ("Sent", "Delivered", "Read", "Failed to send") joined by ` • `.
- **Typing indicator:** `TypingBubble` renders `•••` with `animation: typing-pulse 1s ease-in-out infinite`.

### 3.5 Composer Pattern (`MessageComposer`)

```tsx
<form className="prompt-input" onSubmit={submit}>
  <textarea value={draft} onChange={...} onKeyDown={...} />
  {attachment && <AttachmentChip />}
  <div className="prompt-controls">
    <button type="button" onClick={openFilePicker}>+</button>
    <div>
      <button className={recording ? "recording" : ""}>mic</button>
      <button className="submit-message" type="submit" disabled={!draft.trim()}>send</button>
    </div>
  </div>
</form>
```

- **Send trigger:** `onSubmit` form handler + `onKeyDown` intercepting `Enter` (without `Shift`). `Shift+Enter` produces a newline.
- **Disabled state:** send button disabled when draft is empty (`!draft.trim()`).
- **Attachment chip:** inline, dismissible with `×` button, `aria-label="Remove attachment"`.
- **File input:** hidden (`display: none`), triggered via label/button click, restricted file types via `accept` attribute.

### 3.6 Search Bar Pattern (`ChatSearchBar`, global search)

```tsx
<label className="chat-searchbar">
  <AssetIcon src={assets.icons.search} />
  <input value={query} onChange={...} onKeyDown={closeOnEscape} autoFocus />
  <button onClick={close}>×</button>
</label>
```

- Toggle-based visibility (search overlay appears/disappears).
- `autoFocus` on mount, `Escape` to close.
- Filters use `filterByQuery` — normalizes text (NFD accent stripping, lowercasing) and checks substring match.
- Empty results show `.empty-search`: `No messages match "{query}"`.

### 3.7 Settings Row Pattern (`SettingsRow`)

A list-item-style row that supports two interaction modes:

- **Toggle mode:** renders a switch-like control (`figure-toggle` image or `.settings-toggle-off` pseudo-switch). Uses `role="switch"` + `aria-checked`.
- **Navigation mode:** renders a chevron icon, navigated via `onOpen`.
- Visual separator (`.settings-divider`) between rows except after the last.

### 3.8 Toast / Notification System

```tsx
notify("Message sent");                    // info (default)
notify("File attached", "success");       // green
notify("...", "warning");                 // amber
notify("...", "error");                   // red
```

- `<Toaster />` renders toasts fixed at bottom-center (`left: 50%; bottom: 24px`).
- Auto-dismiss after 3200ms.
- Manual dismiss via `×` button.
- No duplicate toasts with the same message text (reuses ID).
- Visual variants: `.toast-success`, `.toast-warning`, `.toast-error` override background color.

### 3.9 Badge / Pill Pattern

| Class | Usage | Style |
|-------|-------|-------|
| `.priority-pill` | High-urgency conversations | `#eff6ff` bg, `#2563eb` text |
| `.message-pill` | Unread message count | `#f3f4f6` bg, `#4b5563` text |
| `.unread` | Small unread dot | 18×18 circular, blue `#2563eb`, white number |
| `.application-status` | Application row status | Semantic color per status |
| `.nav-label` | Section header in nav | 10px, uppercase, `#757575` |

### 3.10 Card Pattern (`.info-card`)

```css
border: 1px solid #e5e7eb;
border-radius: 16px;
background: white;
padding: 16px;
```

Used for customer info, history/activity, AI summary, and settings cards. Cards stack vertically with consistent gap.

---

## 4. Interaction Patterns

### 4.1 Conversation Selection Flow

1. User clicks a conversation in the list (`ConversationItem` or `ExpandedConversation`).
2. `selectConversation(id)` calls `store.select(id)` then:
   - If the conversation had unread messages, calls `markReadLocally(id)` (optimistic) and sends `wsClient.send("conversation.read", { conversationId: id })`.
3. The selected conversation's unread badge disappears and the item highlights (`.selected`).

### 4.2 Handoff / Escalation Flow

When `conversation.handoff === "needs-human"`:

1. A `HandoffCard` appears above the composer with:
   - Status label "Needs Human Review" + timestamp ("Escalated 2 min ago").
   - Description text.
   - Action group: `TakeOverButton` (primary, blue) + "Regenerate Draft" (outline) + `CallbackButton`.
2. `TakeOverButton` sends `wsClient.send("conversation.takeover", { conversationId })`.
3. After takeover, `conversation.handoff` becomes `"assigned"`, and a confirmation banner `.takeover-confirmation` appears: "You're now handling this conversation."

### 4.3 More Options Menu (Contextual Popover)

```tsx
<button onClick={() => setShowMore(!showMore)}>⋯</button>
{showMore && <div className="more-menu">...</div>}
```

- Positioned absolutely relative to the button container (`.chat-actions`).
- Closes on selecting an item (each `menuAction` resets `showMore`).
- Contains: "Mark as unread", "Assign to me", "Archive conversation".
- `z-index: 20`, `border-radius: 12px`, `box-shadow: 0 12px 28px rgba(17, 24, 39, 0.14)`.

### 4.4 Detail Panel Sub-Navigation

The Customer Context panel uses a `view` state to switch between the overview and detail sub-views:

```tsx
const [view, setView] = useState<"media" | "privacy" | null>(null);
```

- Overview shows a row of `.context-actions` buttons (icon + label).
- Selecting an action sets `view` and renders the corresponding detail panel (`<MediaFilesPanel>`, `<PrivacyPanel>`).
- Detail panels share a `context-detail-panel` layout with a back-arrow header button calling `onBack`.
- When a detail view is active, `.has-detail` class collapses the overview (`overflow: hidden; padding: 0`).

### 4.5 Toggle-Based Feature Activation

Search, settings, and panels all follow the same toggle pattern:

1. A store (`useChatSearchStore`, `useMessageSettingsStore`) holds `open: boolean`.
2. `toggle()` flips the state; `close()`/`setOpen(false)` resets it.
3. Components conditionally render (`if (!open) return null`).
4. Escape key and click-outside close the overlay.

### 4.6 Optimistic Updates

All user-initiated mutations use optimistic updates:

- **Message sending:** appends to local store with `status: "sending"` immediately, then sends via WebSocket. Server ack updates to `"sent"`, `"delivered"`, or `"read"`.
- **Conversation read:** marks `unread: 0` locally, then sends `conversation.read` event.
- **File attachment:** adds filename to store immediately, shows toast.

### 4.7 Draft Persistence

Composer drafts and attachments are keyed by `conversationId` in the `useComposerStore`:

```ts
drafts: Record<string, string>;
attachments: Record<string, string>;
```

This allows switching between conversations without losing in-progress text or attachments.

---

## 5. Visual Design System

### 5.1 Color Palette

| Role | Value | Usage |
|------|-------|-------|
| **Primary** | `#2563eb` | Selected conversation, badges, links |
| **Primary-dark** | `#053cc7` | Active nav items, primary buttons |
| **Accent** | `#722ed1` | AI labels, handoff borders |
| **Success** | `#16a34a` | Delivered/read status |
| **Warning** | `#f59e0b` | Connection status |
| **Error** | `#f5222d` | Urgent badges, failed status |
| **Surface** | `#ffffff` | Cards, panels, chat bubbles |
| **Background** | `#f4f5f7` | Page background |
| **Border** | `#e5e7eb` | Dividers, input borders |
| **Text primary** | `rgba(0, 0, 0, 0.85)` | Body text |
| **Text secondary** | `#6b7280` | Captions, placeholders |
| **Text muted** | `#9ca3af` | Timestamps |

### 5.2 Border Radius Scale

| Name | Value | Usage |
|------|-------|-------|
| `rounded-sm` | 4px | — |
| `rounded-default` | 8px | Buttons, table cells |
| `rounded-md` | 10–12px | Search fields, small cards |
| `rounded-lg` | 14–16px | Conversation items, message bubbles, settings rows |
| `rounded-xl` | 20–24px | Chat headers, compose areas |
| `rounded-full` | 999px | Pills, circular buttons, avatars |

### 5.3 Spacing Scale

Based on 4px increments: `4, 8, 12, 16, 20, 24, 32, 40...`

### 5.4 Typography

| Element | Font weight | Size | Line height | Color |
|---------|------------|------|-------------|-------|
| Body | Regular (400) | 14px | 20px | `#1f2937` |
| Label | Semi Bold (600) | 13–14px | — | `#111827` |
| Caption | Regular (400) | 11–12px | — | `#9ca3af` / `#6b7280` |
| Heading (h1) | Extra Bold (800) | 20–24px (clamp) | — | `#111827` |
| Heading (h2) | Bold (700) | 16–24px (clamp) | — | `#111827` |
| Heading (h3) | Bold (700) | 14–19px (clamp) | — | `#111827` |
| Section label | Medium (500) | 10px | — | `#757575`, uppercase |

Font families use the Inter variable font loaded from Figma (`"Inter:Regular"`, `"Inter:Bold"`, `"Inter:Semi Bold"`, `"Inter:Medium"`, `"Inter:Extra Bold"`).

### 5.5 Shadows

| Usage | Value |
|-------|-------|
| Card/elevated panel | `0 4px 12px rgba(0, 0, 0, 0.05)` or `0 12px 45px rgba(17, 24, 39, 0.18)` |
| Dropdown/menu | `0 12px 28px rgba(17, 24, 39, 0.14)` |
| Modal/dialog | `0 4px 16px rgba(0, 0, 0, 0.25)` |
| Toast | `0 10px 30px rgba(17, 24, 39, 0.25)` |

### 5.6 Focus Styles

Universal focus-visible pattern:
```css
*:focus-visible {
  outline: 3px solid #93b4fc;  /* for light interactive elements */
  outline: 2px solid #2563eb;  /* for submit buttons */
  outline-offset: 2px;
}
```

### 5.7 Animations

| Animation | Trigger | Duration |
|-----------|---------|----------|
| `toast-in` | Toast appear | 0.18s ease-out |
| `settings-in` | Dialog appear | 0.2s ease-out |
| `typing-pulse` | AI typing | 1s ease-in-out infinite |
| Panel slide | Drawer open/close | 0.25s cubic-bezier(0.4, 0, 0.2, 1) |
| Hover lift | Interactive elements | 0.16–0.2s ease |

---

## 6. Responsive Breakpoints

| Max width | Key behaviors |
|-----------|---------------|
| **1440px** | Workspace columns tighten; navbar padding `0 18px` |
| **1250px** | Context panel becomes fixed drawer; triggers `.close-context` / `.context-trigger` visibility |
| **1100px** | Applications nav icons-only; expanded chat repositions |
| **1024px** | Workspace gap narrows; context column fixed at 420px |
| **820px** | Top navbar search collapses; `.circle-action` buttons hide; workspace becomes block layout |
| **700px** | Applications nav hidden; expanded chat inset changes |
| **640px** | Chat header padding reduces; action button gaps tighten |
| **560px** | Global search collapses to icon-only (`.global-search:focus-within` expands to 220px) |
| **480px** | Global search hidden; profile/action buttons hide |

---

## 7. Accessibility Conventions

### 7.1 Icon Buttons

- Every `IconButton` includes `aria-label` (required) and `title` (same label).
- Decorative images use `alt=""`.

### 7.2 Semantic Roles

| Element | Role / Attribute |
|---------|------------------|
| Settings dialog | `role="dialog"`, `aria-modal="true"`, `aria-labelledby` |
| Settings toggle row | `role="switch"`, `aria-checked` |
| Media filter toggle | `aria-pressed` |
| Toast | `role="status"` |
| Typing indicator | `aria-label="Customer is typing"` |
| Chat stream | `aria-live="polite"` |

### 7.3 Keyboard Navigation

- **Escape** closes: dialogs, search bars, more-menu (via state reset).
- **Enter** sends message (without Shift); Shift+Enter inserts newline.
- **Tab** focus moves naturally through interactive elements.
- Focus-visible outlines are applied consistently.

### 7.4 Screen Reader Considerations

- `sr-only`-style elements are avoided; instead, `aria-label` is used on icon-only controls.
- Status updates (typing, message status) use `aria-live="polite"` on the chat stream.
- Time elements in message blocks are visible but styled with muted color.

---

## 8. Toast & Feedback Patterns

All user-initiated actions surface feedback via `notify()`:

| Action | Toast message | Type |
|--------|--------------|------|
| Message sent | "Message sent" | info |
| File attached | "File attached" | info |
| Voice record start | "Voice recording started" | info |
| Voice record stop | "Voice recording stopped" | info |
| Conversation opened | `Opened {name}'s conversation` | info |
| Take over | (server-driven) | — |
| Callback requested | (server-driven) | — |
| Settings change | e.g. "Read receipts enabled" | info |
| Copy reference | "Conversation reference copied" | info |
| File upload | "File uploaded securely" | success |
| File download | "{filename} downloaded" | info |
| Notifications | "You have 3 new notifications" | info |
| Error | — | error |

**Convention:** Every user click that triggers a non-trivial side effect (even if it only mutates local state) calls `notify()`. This provides consistent feedback and demonstrates the interaction worked.

---

## 9. State Container Conventions

### 9.1 Store Shape

Each feature/entity exposes a Zustand store via `index.ts`:

```ts
export { useXStore, useXSelections, type XType } from "./model/store";
```

Store state is a flat object; mutations return new state via Immer-style setters or explicit spread.

### 9.2 Derived Selectors

Instead of storing derived data, hooks compute it via selectors:

```ts
export const useSelectedConversation = () =>
  useConversationStore((state) => (state.selectedId ? state.byId[state.selectedId] : undefined));

export const useDraft = (conversationId: string) =>
  useComposerStore((state) => state.drafts[conversationId] ?? "");
```

### 9.3 Side Effects

WebSocket sends are colocated in feature actions (not in components):

```ts
// selectConversation.ts
export function selectConversation(id: string) {
  const store = useConversationStore.getState();
  store.select(id);
  if (store.byId[id]?.unread) {
    store.markReadLocally(id);
    wsClient.send("conversation.read", { conversationId: id });
  }
}
```

---

## 10. File Organization

```
src/
├── app/                      # Root, providers
│   ├── App.tsx
│   ├── providers/
│   └── styles/
├── pages/                    # Page components
│   ├── chat/ChatPage.tsx
│   └── applications/ApplicationsPage.tsx
├── widgets/                  # Section-level UI
│   ├── top-navbar/
│   ├── conversation-sidebar/
│   ├── chat-window/
│   ├── customer-context/
│   └── applications-workspace/
├── features/                 # User-facing actions
│   ├── send-message/
│   ├── select-conversation/
│   ├── take-over-conversation/
│   ├── request-callback/
│   ├── message-settings/
│   ├── search-in-chat/
│   ├── privacy-controls/
│   └── share-files/
├── entities/                 # Domain concepts
│   ├── conversation/
│   └── message/
└── shared/                   # Framework-agnostic utilities
    ├── ui/                   # Reusable components
    ├── api/ws/               # WebSocket client
    ├── config/               # Assets, constants
    └─ lib/                   # Utilities (format-time, etc.)
```

**Barrel exports:** Every segment directory has an `index.ts` that re-exports its public API. Cross-segment imports use `@/layer/segment` path aliases, never direct file paths into another segment's internals.
