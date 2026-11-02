import { useConversationStore } from "@/entities/conversation";
import { useMessageStore } from "@/entities/message";
import { wsClient } from "@/shared/api/ws";
import { useMessageSettingsStore } from "@/features/message-settings";
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
    if (!useMessageSettingsStore.getState().values.typingSound || !window.AudioContext) return;
    audio ??= new AudioContext();
    void audio.resume().catch(() => {});
  };
  if (typeof window !== "undefined") window.addEventListener("pointerdown", unlockAudio);
  const conversations = useConversationStore;
  const messages = useMessageStore;

  const offs = [
    wsClient.onStatus((status) => status === "open" && wsClient.send("sync.request", {})),
    wsClient.on("sync", (payload) => {
      conversations.getState().setAll(payload.conversations);
      messages.getState().replaceAll(payload.messages);
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
      const preferences = useMessageSettingsStore.getState().values;
      if (isNew && preferences.conversationAlerts) notify(`New conversation from ${conversation.name}`);
      if (isNew && preferences.autoAssign && conversation.handoff !== "assigned") {
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
