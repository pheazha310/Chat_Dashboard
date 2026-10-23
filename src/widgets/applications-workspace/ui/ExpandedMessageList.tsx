import { useMemo, useState } from "react";
import { useConversationStore } from "@/entities/conversation";
import { useMessageSettingsStore } from "@/features/message-settings";
import { selectConversation } from "@/features/select-conversation";
import { assets } from "@/shared/config";
import { formatListTime } from "@/shared/lib/format-time";
import { AssetIcon, notify, Icon, IconPill } from "@/shared/ui";

type Props = { onClose: () => void; onOpened: () => void };

export default function ExpandedMessageList({ onClose, onOpened }: Props) {
  const byId = useConversationStore((state) => state.byId);
  const order = useConversationStore((state) => state.order);
  const openSettings = useMessageSettingsStore((state) => state.setOpen);
  const [panelQuery, setPanelQuery] = useState("");

  const panelConversations = useMemo(
    () =>
      order
        .map((id) => byId[id])
        .filter((item) => item && item.name.toLowerCase().includes(panelQuery.toLowerCase()))
        .slice(0, 7),
    [byId, order, panelQuery],
  );

  return (
    <aside className="expanded-message-list">
      <header>
        <h2>Message</h2>
        <div className="expanded-list-actions">
          <IconPill left="collapse" right="more" />
          <button
            type="button"
            className="collapse-hit"
            onClick={onClose}
            aria-label="Return to main message workspace"
          />
          <button
            type="button"
            className="settings-hit"
            onClick={() => openSettings(true)}
            aria-label="Open message settings"
          />
        </div>
      </header>
      <label>
        <AssetIcon src={assets.icons.search} size={16} />
        <input value={panelQuery} onChange={(event) => setPanelQuery(event.target.value)} placeholder="Quick Search" />
      </label>
      <div>
        {panelConversations.map((item) => (
          <button
            className="expanded-conversation"
            key={item.id}
            onClick={() => {
              selectConversation(item.id);
              onOpened();
              notify(`Opened ${item.name}'s conversation`);
            }}
          >
            <img src={item.avatar} alt="" />
            <span>
              <span>
                <strong>{item.name}</strong>
                <time>{formatListTime(item.lastMessageAt)}</time>
              </span>
              <span>
                <small className={item.urgent ? "urgent" : ""}>{item.preview}</small>
                {item.unread > 0 && <b className={item.urgent ? "urgent" : ""}>{item.unread}</b>}
              </span>
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}
