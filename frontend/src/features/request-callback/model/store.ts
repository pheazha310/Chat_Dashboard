import { create } from "zustand";
import {
  cancelCallbackRequest,
  completeCallbackRequest,
  listCallbacks,
  scheduleCallbackRequest,
  type Callback,
} from "@/shared/api/rest";
import { notify } from "@/shared/ui";

type CallbacksState = {
  byConversation: Record<string, Callback[]>;
  status: Record<string, "loading" | "ready" | "error">;
};

export const useCallbackStore = create<CallbacksState>(() => ({ byConversation: {}, status: {} }));

const bySoonest = (a: Callback, b: Callback) => a.scheduledAt.localeCompare(b.scheduledAt) || a.id.localeCompare(b.id);
const failure = (error: unknown, fallback: string) => notify(error instanceof Error ? error.message : fallback);

const put = (callback: Callback) =>
  useCallbackStore.setState((state) => {
    const others = (state.byConversation[callback.conversationId] ?? []).filter((item) => item.id !== callback.id);
    return {
      byConversation: { ...state.byConversation, [callback.conversationId]: [...others, callback].sort(bySoonest) },
    };
  });

export async function loadCallbacks(conversationId: string) {
  useCallbackStore.setState((state) => ({ status: { ...state.status, [conversationId]: "loading" } }));
  try {
    const items = await listCallbacks(conversationId);
    useCallbackStore.setState((state) => ({
      byConversation: { ...state.byConversation, [conversationId]: [...items].sort(bySoonest) },
      status: { ...state.status, [conversationId]: "ready" },
    }));
  } catch {
    useCallbackStore.setState((state) => ({ status: { ...state.status, [conversationId]: "error" } }));
  }
}

/** `localTime` is what a datetime-local field holds. It is read in this browser's time zone and sent with an offset. */
export async function scheduleCallback(conversationId: string, localTime: string, notes: string) {
  const at = new Date(localTime);
  if (Number.isNaN(at.getTime())) {
    notify("Pick a date and time for the callback");
    return false;
  }
  try {
    put(await scheduleCallbackRequest(conversationId, at.toISOString(), notes.trim() || undefined));
    notify("Callback scheduled");
    return true;
  } catch (error) {
    failure(error, "Could not schedule the callback");
    return false;
  }
}

export async function completeCallback(callback: Callback, completionNote?: string) {
  try {
    put(await completeCallbackRequest(callback.id, completionNote?.trim() || undefined));
    return true;
  } catch (error) {
    failure(error, "Could not complete the callback");
    void loadCallbacks(callback.conversationId); // it may have been closed by someone else
    return false;
  }
}

export async function cancelCallback(callback: Callback) {
  try {
    put(await cancelCallbackRequest(callback.id));
    return true;
  } catch (error) {
    failure(error, "Could not cancel the callback");
    void loadCallbacks(callback.conversationId);
    return false;
  }
}
