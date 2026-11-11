import { create } from "zustand";
import type { ChatMessage } from "@/entities/message";
import { listPinsRequest, pinRequest, unpinRequest, type BackendPin } from "@/shared/api/rest";
import { notify } from "@/shared/ui";

/** One entry of the pin bar. `sequence` lets the chat load back to the message. */
export type PinnedMessage = { messageId: string; sequence: string; text: string };

type PinState = { byConversation: Record<string, PinnedMessage[]> };

/** Pinned messages per conversation, shared by every agent of the chat (newest pin first). */
export const usePinStore = create<PinState>(() => ({ byConversation: {} }));

const EMPTY: PinnedMessage[] = [];
export const useConversationPins = (conversationId: string) =>
  usePinStore((state) => state.byConversation[conversationId] ?? EMPTY);

const toPinned = (pin: BackendPin): PinnedMessage => ({
  messageId: pin.messageId,
  sequence: pin.message.sequenceNumber,
  text: pin.message.content ?? "",
});

const setPins = (conversationId: string, pins: PinnedMessage[]) =>
  usePinStore.setState((state) => ({ byConversation: { ...state.byConversation, [conversationId]: pins } }));

/** Loads the pin bar when a conversation is opened. Pins are a convenience: failing leaves the bar empty. */
export async function loadPins(conversationId: string): Promise<void> {
  try {
    setPins(conversationId, (await listPinsRequest(conversationId)).map(toPinned));
  } catch {
    setPins(conversationId, []);
  }
}

/** Pins a message, or unpins it if it is pinned. The server decides who may; a refusal is shown as a notice. */
export async function togglePin(message: ChatMessage): Promise<void> {
  const current = usePinStore.getState().byConversation[message.conversationId] ?? [];
  const pinned = current.some((pin) => pin.messageId === message.id);
  try {
    if (pinned) {
      await unpinRequest(message.id);
      setPins(
        message.conversationId,
        current.filter((pin) => pin.messageId !== message.id),
      );
    } else {
      const pin = toPinned(await pinRequest(message.id));
      setPins(message.conversationId, [pin, ...current.filter((p) => p.messageId !== pin.messageId)]);
    }
  } catch (error) {
    notify(error instanceof Error ? error.message : "Could not change the pin");
  }
}
