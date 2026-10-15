import { assets } from "@/shared/config";
import { AssetIcon } from "@/shared/ui";
import { useChatSearchStore } from "../model/store";

export default function ChatSearchBar() {
  const { open, query, setQuery, close } = useChatSearchStore();
  if (!open) return null;
  return (
    <label className="chat-searchbar">
      <AssetIcon src={assets.icons.search} size={16} />
      <input
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search in conversation"
      />
      <button onClick={close} aria-label="Close conversation search">
        ×
      </button>
    </label>
  );
}
