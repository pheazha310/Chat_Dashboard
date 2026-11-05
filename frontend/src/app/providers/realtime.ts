import { loadDetails, useConversationStore } from "@/entities/conversation";
import { catchUp, loadHistory, newestSequences, useMessageStore } from "@/entities/message";
import { useSessionStore } from "@/shared/api/session";
import { isMockTransport, wsClient } from "@/shared/api/ws";
import { useMessageSettingsStore } from "@/features/message-settings";
import { requestBrowserNotificationPermission, showBrowserNotification } from "@/shared/lib/browser-notification";
import { notify } from "@/shared/ui";

/** Routes server events into the entity stores. Returns a teardown function. */
export function startRealtime() {
  let audio: AudioContext | undefined;
  const playTypingSound = () => {
    if (typeof window === "undefined" || !window.AudioContext) return;
    try {
      audio ??= new AudioContext();
      if (audio.state !== "running") return;
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.frequency.value = 660;
      gain.gain.setValueAtTime(0.025, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.08);
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.start();
      oscillator.stop(audio.currentTime + 0.08);
    } catch {
      /* Sound is optional when the browser restricts audio. */
    }
  };
  const unlockAudio = () => {
    // Browsers only allow the permission prompt from a user gesture.
    if (!isMockTransport) requestBrowserNotificationPermission();
    if (!useMessageSettingsStore.getState().values.typingSound || !window.AudioContext) return;
    audio ??= new AudioContext();
    void audio.resume().catch(() => {});
  };
  if (typeof window !== "undefined") window.addEventListener("pointerdown", unlockAudio);
  const conversations = useConversationStore;
  const messages = useMessageStore;

  /** Tells the server what we already hold, so a reconnect brings back only what was missed. */
  const syncRequest = () => {
    const cursors = newestSequences(messages.getState().byConversation);
    const { selectedId } = conversations.getState();
    return {
      ...(Object.keys(cursors).length > 0 ? { cursors } : {}),
      ...(selectedId ? { selectedConversationId: selectedId } : {}),
    };
  };

  const offs = [
    wsClient.onStatus((status) => status === "open" && wsClient.send("sync.request", syncRequest())),
    wsClient.on("sync", (payload) => {
      conversations.getState().setAll(payload.conversations);
      if (payload.partial) messages.getState().mergeMany(payload.messages);
      else messages.getState().replaceAll(payload.messages);
      // The open conversation needs its history and side-panel details; others load when they are opened.
      const { selectedId } = conversations.getState();
      if (selectedId) {
        void loadHistory(selectedId);
        void loadDetails(selectedId);
      }
      payload.incomplete?.forEach((id) => void catchUp(id));
    }),
    wsClient.on("message.failed", ({ conversationId, clientId, reason }) => {
      messages.getState().setStatus(conversationId, clientId, "failed");
      notify(reason ?? "Message could not be sent");
    }),
    wsClient.on("conversation.removed", ({ conversationId }) => conversations.getState().remove(conversationId)),
    wsClient.on("conversation.unread", ({ conversationId, unread }) =>
      conversations.getState().setUnread(conversationId, unread),
    ),
    wsClient.on("notification", ({ notification }) => {
      notify(notification.text);
      showBrowserNotification("Chat Dashboard", notification.text);
    }),
    wsClient.on("message.new", ({ message }) => messages.getState().upsert(message)),
    wsClient.on("message.ack", ({ message }) => messages.getState().upsert(message)),
    wsClient.on("message.status", ({ conversationId, messageId, status }) =>
      messages.getState().setStatus(conversationId, messageId, status),
    ),
    wsClient.on("typing", ({ conversationId, side, active }) => {
      const wasTyping = messages.getState().typing[conversationId] === side;
      messages.getState().setTyping(conversationId, side, active);
      if (
        active &&
        !wasTyping &&
        side === "customer" &&
        conversations.getState().selectedId === conversationId &&
        useMessageSettingsStore.getState().values.typingSound
      )
        playTypingSound();
    }),
    wsClient.on("conversation.updated", ({ conversation }) => {
      const store = conversations.getState();
      const isNew = !store.byId[conversation.id];
      // The backend only shows an agent their own, queued and AI-handled chats (supervisors see all). If this update
      // says someone else owns it, it just left this agent's inbox: drop it rather than show "handled by <other>".
      const session = useSessionStore.getState();
      const sees = session.role === "SUPERVISOR" || session.role === "ADMIN";
      if (
        !isMockTransport &&
        !sees &&
        conversation.handoff === "assigned" &&
        conversation.assignedAgent &&
        conversation.assignedAgent.id !== session.userId
      ) {
        if (!isNew) notify(`Conversation moved to ${conversation.assignedAgent.name}`);
        store.remove(conversation.id);
        return;
      }
      const preferences = useMessageSettingsStore.getState().values;
      if (isNew && preferences.conversationAlerts) notify(`New conversation from ${conversation.name}`);
      // Mock only: with the real backend an assignment exists only once the server confirms it (conversation.assigned).
      if (isMockTransport && isNew && preferences.autoAssign && conversation.handoff !== "assigned") {
        conversation = {
          ...conversation,
          handoff: "assigned",
          assignedAgent: { id: "local-agent", name: "You", avatar: "", active: true },
        };
      }
      const viewing = store.selectedId === conversation.id && conversation.unread > 0;
      store.upsert(viewing ? { ...conversation, unread: 0 } : conversation);
      if (viewing) wsClient.send("conversation.read", { conversationId: conversation.id });
    }),
    wsClient.on("conversation.assigned", ({ conversationId, agent }) => {
      const store = conversations.getState();
      const conversation = store.byId[conversationId];
      if (!conversation) return;
      store.upsert({ ...conversation, handoff: "assigned", assignedAgent: agent });
      notify(`Conversation assigned to ${agent.name}`);
    }),
    wsClient.on("notice", ({ text }) => notify(text)),
  ];

  wsClient.connect();
  return () => {
    if (typeof window !== "undefined") window.removeEventListener("pointerdown", unlockAudio);
    if (audio) void audio.close().catch(() => {});
    offs.forEach((off) => off());
    wsClient.disconnect();
  };
}
