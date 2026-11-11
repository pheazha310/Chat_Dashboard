import { useEffect, useRef } from "react";
import { assets } from "@/shared/config";
import { AssetIcon } from "@/shared/ui";
import { runSearch, step, useChatSearchStore } from "../model/store";
import JumpToDateButton from "./JumpToDateButton";

/** Wait this long after the last key before searching, so typing a word sends one request, not one per letter. */
const TYPING_PAUSE_MS = 300;

/**
 * Find in conversation, the way chat apps and browsers do it: Ctrl/⌘+F opens it, results come while typing,
 * Enter / ↑ goes to the older match, Shift+Enter / ↓ to the newer one, Esc closes.
 */
export default function ChatSearchBar({ conversationId }: { conversationId: string }) {
  const open = useChatSearchStore((state) => state.open);
  const query = useChatSearchStore((state) => state.query);
  const hits = useChatSearchStore((state) => state.hits);
  const active = useChatSearchStore((state) => state.active);
  const searching = useChatSearchStore((state) => state.searching);
  const hasMore = useChatSearchStore((state) => state.hasMore);
  const recent = useChatSearchStore((state) => state.recent);
  const { setQuery, close } = useChatSearchStore.getState();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        useChatSearchStore.setState({ open: true });
        inputRef.current?.select();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => void runSearch(conversationId, query), TYPING_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [open, query, conversationId]);

  if (!open) return null;

  const counter = hits.length
    ? `${active + 1} of ${hits.length}${hasMore ? "+" : ""}`
    : searching
      ? "Searching…"
      : query.trim()
        ? "No results"
        : "";

  return (
    <div className="chat-searchbar" role="search">
      <AssetIcon src={assets.icons.search} size={16} />
      <input
        ref={inputRef}
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") close();
          if (event.key === "Enter") void step(conversationId, event.shiftKey ? -1 : 1);
        }}
        placeholder="Search in conversation"
        aria-label="Search in conversation"
      />
      <span className="chat-search-count" aria-live="polite">
        {counter}
      </span>
      <button
        type="button"
        onClick={() => void step(conversationId, 1)}
        disabled={active >= hits.length - 1}
        aria-label="Older match"
        title="Older match (Enter)"
      >
        ↑
      </button>
      <button
        type="button"
        onClick={() => void step(conversationId, -1)}
        disabled={active <= 0}
        aria-label="Newer match"
        title="Newer match (Shift+Enter)"
      >
        ↓
      </button>
      <JumpToDateButton conversationId={conversationId} label="Jump to a date">
        📅
      </JumpToDateButton>
      <button type="button" onClick={close} aria-label="Close conversation search" title="Close (Esc)">
        ×
      </button>
      {!query.trim() && recent.length > 0 && (
        <div className="chat-search-recent" aria-label="Recent searches">
          <span>Recent</span>
          {recent.map((item) => (
            <button
              type="button"
              key={item}
              onClick={() => {
                setQuery(item);
                inputRef.current?.focus();
              }}
            >
              {item}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
