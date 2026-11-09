import { useConversationStore } from "@/entities/conversation";
import { ProfileMenu } from "@/features/auth";
import { assets } from "@/shared/config";
import { AssetIcon, IconButton, notify } from "@/shared/ui";

// function ConnectionPill() {
//   const status = useConnectionStore((state) => state.status);
//   const label =
//     status === "open"
//       ? "Live"
//       : status === "idle"
//         ? "Offline"
//         : status === "connecting"
//           ? "Connecting…"
//           : "Reconnecting…";
//   return (
//     <button
//       className={`connection-pill ${status}`}
//       onClick={isMockTransport ? simulateDisconnect : undefined}
//       title={isMockTransport ? "Mock server — click to simulate a dropped connection" : "WebSocket connection"}
//     >
//       <i />
//       {label}
//     </button>
//   );
// }

export default function TopNavbar({ onOpenInbox }: { onOpenInbox: () => void }) {
  const query = useConversationStore((state) => state.query);
  const setQuery = useConversationStore((state) => state.setQuery);

  return (
    <header className="top-navbar">
      <button className="mobile-menu" onClick={onOpenInbox} aria-label="Open messages">
        ☰
      </button>
      <label className="global-search">
        <AssetIcon src={assets.icons.search} size={16} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Quick Search - Name, Number, Status, Cycle..."
          aria-label="Global quick search"
        />
      </label>
      <div className="top-actions">
        {/* <ConnectionPill /> */}
        <IconButton className="circle-action" icon={assets.icons.message} label="Messages" onClick={onOpenInbox} />
        <button
          className="circle-action notification"
          onClick={() => notify("You have 3 new notifications")}
          aria-label="Notifications"
        >
          <AssetIcon src={assets.icons.bell} />
        </button>
        <ProfileMenu />
      </div>
    </header>
  );
}
