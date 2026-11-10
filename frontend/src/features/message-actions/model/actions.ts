import { create } from "zustand";
import { useMessageStore, type ChatMessage } from "@/entities/message";
import {
  deleteMessageRequest,
  editMessageRequest,
  forwardRequest,
  reactRequest,
  unreactRequest,
} from "@/shared/api/rest";
import { toMessage, toReaction } from "@/shared/api/backend/mappers";
import { useSessionStore } from "@/shared/api/session";
import { notify } from "@/shared/ui";

/** Which message is being edited inline. */
export const useEditingStore = create<{ editingId: string | null; set: (id: string | null) => void }>((set) => ({
  editingId: null,
  set: (editingId) => set({ editingId }),
}));

const isSupervisor = () => ["SUPERVISOR", "ADMIN"].includes(useSessionStore.getState().role ?? "");

/** Pending (optimistic) and failed messages have no server copy yet, so nothing can be done with them. */
const isStored = (message: ChatMessage) => message.status !== "sending" && message.status !== "failed";

export function availableActions(message: ChatMessage) {
  const mine = message.side === "agent" && message.senderId === useSessionStore.getState().userId;
  const stored = isStored(message) && message.side !== "system" && !message.deleted;
  return {
    reply: stored,
    react: stored,
    // The server forwards text only (files arrive with FR-17); anything else is a 400.
    forward: stored && !message.attachments?.length && message.text.trim() !== "",
    copy: message.side !== "system" && !message.deleted,
    edit: stored && mine,
    remove: stored && (mine || (isSupervisor() && message.side !== "system")),
  };
}

const failure = (error: unknown, fallback: string) => notify(error instanceof Error ? error.message : fallback);

export function replyTo(message: ChatMessage) {
  useMessageStore.getState().setReplyTarget(message.conversationId, message.id);
}

export async function copyMessage(message: ChatMessage) {
  try {
    await navigator.clipboard.writeText(message.text);
    notify("Message copied");
  } catch {
    notify("Could not copy the message");
  }
}

export async function saveEdit(message: ChatMessage, text: string) {
  const trimmed = text.trim();
  if (!trimmed || trimmed === message.text) return void useEditingStore.getState().set(null);
  try {
    useMessageStore.getState().upsert(toMessage(await editMessageRequest(message.id, trimmed)));
    useEditingStore.getState().set(null);
  } catch (error) {
    failure(error, "Could not edit the message");
  }
}

export async function deleteMessage(message: ChatMessage) {
  try {
    await deleteMessageRequest(message.id);
    useMessageStore.getState().markDeleted(message.conversationId, message.id);
  } catch (error) {
    failure(error, "Could not delete the message");
  }
}

/** Adds the caller's reaction, or removes it when they already reacted with that emoji. */
export async function toggleReaction(message: ChatMessage, emoji: string) {
  const me = useSessionStore.getState().userId;
  const existing = message.reactions?.find((reaction) => reaction.emoji === emoji && reaction.userId === me);
  try {
    const { reactions } = existing
      ? await unreactRequest(message.id, existing.id)
      : await reactRequest(message.id, emoji);
    useMessageStore.getState().setReactions(message.conversationId, message.id, reactions.map(toReaction));
  } catch (error) {
    failure(error, "Could not update the reaction");
  }
}

export async function forwardMessage(message: ChatMessage, targetConversationId: string) {
  try {
    await forwardRequest(message.id, targetConversationId, `c-${crypto.randomUUID()}`);
    notify("Message forwarded");
    return true;
  } catch (error) {
    failure(error, "Could not forward the message");
    return false;
  }
}
