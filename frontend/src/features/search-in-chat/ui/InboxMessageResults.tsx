import { useEffect } from "react";
import { splitMatches } from "@/entities/message";
import { searchEverywhere, useInboxSearchStore, type InboxHit } from "../model/inbox";

const TYPING_PAUSE_MS = 300;

const formatDay = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString([], { month: "short", day: "numeric" });
};

/** The "Messages" part of the inbox search: what was said, under the customer who said it (like Gmail or Messenger). */
export default function InboxMessageResults({
  query,
  onOpen,
}: {
  query: string;
  onOpen: (hit: InboxHit) => void | Promise<void>;
}) {
  const results = useInboxSearchStore((state) => state.results);
  const hasMore = useInboxSearchStore((state) => state.hasMore);
  const searching = useInboxSearchStore((state) => state.searching);

  useEffect(() => {
    const timer = setTimeout(() => void searchEverywhere(query), TYPING_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const text = query.trim();
  if (!text) return null;
  const firstWord = text.split(/\s+/)[0] ?? "";

  return (
    <section className="inbox-message-results" aria-label="Messages matching the search">
      <h2>Messages{results.length > 0 && ` (${results.length}${hasMore ? "+" : ""})`}</h2>
      {searching && results.length === 0 && <p className="empty-search">Searching messages…</p>}
      {!searching && results.length === 0 && <p className="empty-search">No messages with “{text}”</p>}
      {results.map((hit) => (
        <button type="button" key={hit.messageId} className="inbox-message-hit" onClick={() => void onOpen(hit)}>
          <span className="inbox-message-hit-head">
            <strong>{hit.customer}</strong>
            <time>{formatDay(hit.createdAt)}</time>
          </span>
          <span className="inbox-message-hit-text">
            {splitMatches(hit.text, firstWord).map((part, i) =>
              part.match ? <mark key={i}>{part.text}</mark> : part.text,
            )}
          </span>
        </button>
      ))}
      {hasMore && <p className="inbox-message-more">Showing the newest {results.length}. Add a word to narrow it.</p>}
    </section>
  );
}
