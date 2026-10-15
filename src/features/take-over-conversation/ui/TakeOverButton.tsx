import { takeOverConversation } from "../model/takeOver";

export default function TakeOverButton({ conversationId }: { conversationId: string }) {
  return (
    <button className="take-over" onClick={() => takeOverConversation(conversationId)}>
      Take Over
    </button>
  );
}
