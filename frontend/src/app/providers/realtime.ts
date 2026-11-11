import { loadDetails, useConversationStore } from "@/entities/conversation";
import { catchUp, loadHistory, newestSequences, useMessageStore } from "@/entities/message";
import { loadNotifications, useNotificationStore } from "@/entities/notification";
import { useSessionStore } from "@/shared/api/session";
import { isMockTransport, wsClient } from "@/shared/api/ws";
import { useNotesStore } from "@/features/internal-notes";
import { useChatTabsStore } from "@/features/chat-tabs";
import { applyRemoteDraft, hydrateDrafts } from "@/features/send-message";
import { getChatSettings, getWorkspace } from "@/shared/api/rest";
import { API_URL } from "@/shared/config";
import {
  onCallAccepted,
  onCallAnswer,
  onCallCandidate,
  onCallDeclined,
  onCallEnded,
  onCallIncoming,
  onCallOffer,
} from "@/features/customer-call";
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

  /** Brings back last session's tabs and unsent drafts. Runs once, after the first sync has filled the inbox. */
  let workspaceLoaded = false;
  const loadWorkspace = () => {
    if (workspaceLoaded || !API_URL || isMockTransport) return;
    workspaceLoaded = true;
    void getWorkspace()
      .then(({ tabs, drafts }) => {
        const known = new Set(tabs.map((tab) => tab.conversationId));
        // Tabs opened in this window before the answer arrived stay.
        const current = useChatTabsStore.getState().openIds.filter((id) => !known.has(id));
        useChatTabsStore.getState().setTabs([...tabs.map((tab) => tab.conversationId), ...current]);
        hydrateDrafts(drafts);
      })
      .catch(() => {
        workspaceLoaded = false; // try again after the next sync
      });
  };

  /** Brings the agent's saved switches (sounds, AI, auto-assign) from the backend. Runs once, like the workspace. */
  let settingsLoaded = false;
  const loadChatSettings = () => {
    if (settingsLoaded || !API_URL || isMockTransport) return;
    settingsLoaded = true;
    void getChatSettings()
      .then((settings) => useMessageSettingsStore.getState().applyRemote(settings))
      .catch(() => {
        settingsLoaded = false; // try again after the next sync
      });
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
      loadWorkspace();
      loadChatSettings();
      void loadNotifications();
    }),
    // Another window of this agent changed the workspace.
    wsClient.on("workspace.tab_opened", ({ conversationId }) => useChatTabsStore.getState().add(conversationId)),
    wsClient.on("workspace.tab_closed", ({ conversationId }) => useChatTabsStore.getState().remove(conversationId)),
    wsClient.on("workspace.draft_updated", ({ conversationId, content, updatedAt }) =>
      applyRemoteDraft(conversationId, content, updatedAt),
    ),
    wsClient.on("chat_settings.updated", ({ settings }) => useMessageSettingsStore.getState().applyRemote(settings)),
    wsClient.on("call.incoming", onCallIncoming),
    wsClient.on("call.accepted", (payload) => void onCallAccepted(payload)),
    wsClient.on("call.declined", onCallDeclined),
    wsClient.on("call.ended", onCallEnded),
    wsClient.on("call.offer", (payload) => void onCallOffer(payload)),
    wsClient.on("call.answer", (payload) => void onCallAnswer(payload)),
    wsClient.on("call.ice_candidate", (payload) => void onCallCandidate(payload)),
    wsClient.on("message.failed", ({ conversationId, clientId, reason }) => {
      messages.getState().setStatus(conversationId, clientId, "failed");
      notify(reason ?? "Message could not be sent");
    }),
    wsClient.on("conversation.removed", ({ conversationId }) => conversations.getState().remove(conversationId)),
    wsClient.on("conversation.unread", ({ conversationId, unread }) =>
      conversations.getState().setUnread(conversationId, unread),
    ),
    wsClient.on("notification", ({ notification }) => {
      useNotificationStore.getState().add(notification);
      notify(notification.text);
      showBrowserNotification("Chat Dashboard", notification.text);
    }),
    wsClient.on("notification.read", ({ notificationId, unreadCount }) =>
      useNotificationStore.getState().applyRead(notificationId, unreadCount),
    ),
    wsClient.on("message.new", ({ message }) => messages.getState().upsert(message)),
    wsClient.on("message.ack", ({ message }) => messages.getState().upsert(message)),
    wsClient.on("message.updated", ({ message }) => messages.getState().upsert(message)),
    wsClient.on("message.deleted", ({ conversationId, messageId }) =>
      messages.getState().markDeleted(conversationId, messageId),
    ),
    wsClient.on("note.created", ({ note }) => useNotesStore.getState().upsert(note)),
    wsClient.on("note.updated", ({ note }) => useNotesStore.getState().upsert(note)),
    wsClient.on("note.deleted", ({ conversationId, noteId }) =>
      useNotesStore.getState().remove(conversationId, noteId),
    ),
    wsClient.on("conversation.escalated", ({ conversationId, status, requestedBy }) => {
      const name = conversations.getState().byId[conversationId]?.name ?? "A conversation";
      if (status === "PENDING" && requestedBy !== useSessionStore.getState().userId) notify(`${name} was escalated`);
    }),
    wsClient.on("attachment.deleted", ({ conversationId, attachmentId }) =>
      messages.getState().removeAttachment(conversationId, attachmentId),
    ),
    wsClient.on("message.reaction_updated", ({ conversationId, messageId, reactions }) =>
      messages.getState().setReactions(conversationId, messageId, reactions),
    ),
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
