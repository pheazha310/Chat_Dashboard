import { wsClient } from "@/shared/api/ws";
import { assets } from "@/shared/config";
import { AssetIcon } from "@/shared/ui";

export default function CallbackButton({ conversationId }: { conversationId: string }) {
  return (
    <button className="callback-action" onClick={() => wsClient.send("callback.request", { conversationId })}>
      <AssetIcon src={assets.icons.callback} size={18} /> Send Callback
    </button>
  );
}
