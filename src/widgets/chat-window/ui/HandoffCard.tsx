import { CallbackButton } from "@/features/request-callback";
import { TakeOverButton } from "@/features/take-over-conversation";

type Props = { conversationId: string; onRegenerateDraft: () => void };

export default function HandoffCard({ conversationId, onRegenerateDraft }: Props) {
  return (
    <div className="handoff-card">
      <div className="handoff-heading">
        <span>Needs Human Review</span>
        <time>Escalated 2 min ago</time>
      </div>
      <p>Customer needs a repayment date change. Review, verify the customer, and confirm the updated schedule.</p>
      <div>
        <TakeOverButton conversationId={conversationId} />
        <button className="regenerate" onClick={onRegenerateDraft}>
          Regenerate Draft
        </button>
        <CallbackButton conversationId={conversationId} />
      </div>
    </div>
  );
}
