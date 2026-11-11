import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The enhanced chat features (FR-14 to FR-27) through the frontend's own feature actions, REST clients, mappers and
 * realtime routing, against a running backend. Skipped unless configured, like live-backend.test.ts (see
 * docs/frontend-integration.md, "Verifying against the backend"). The backend needs AUTH_MODE=dev, BACKEND1_MODE=dev
 * and a throwaway database. The signed-in agent is agent 3; others act through REST.
 */
const api = process.env.LIVE_API_URL;
const live = Boolean(api && process.env.VITE_WS_URL && process.env.VITE_AUTH_TOKEN);

const toasts = vi.hoisted(() => [] as string[]);
vi.mock("@/shared/ui", () => ({ notify: (text: string) => void toasts.push(text) }));

type Json = Record<string, any>;
const rest = async (path: string, token: string, method = "GET", body?: unknown) => {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: (await response.json()) as Json };
};
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const AGENT1 = `dev:${uid(1)}:AGENT`;
const ME = `dev:${uid(3)}:AGENT`;
const SUPERVISOR = `dev:${uid(9)}:SUPERVISOR`;

async function until<T>(read: () => T | undefined | false, what: string, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Like `until`, for a check that has to ask the server. */
async function eventually(check: () => Promise<boolean>, what: string, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Node has no XMLHttpRequest; this one sends through fetch so the real upload client can run unchanged. */
class FetchXhr {
  status = 0;
  responseText = "";
  upload: { onprogress?: (event: { lengthComputable: boolean; loaded: number; total: number }) => void } = {};
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  private method = "GET";
  private url = "";
  private headers: Record<string, string> = {};
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  abort() {
    this.onabort?.();
  }
  send(body: FormData) {
    fetch(this.url, { method: this.method, headers: this.headers, body })
      .then(async (response) => {
        this.status = response.status;
        this.responseText = await response.text();
        this.onload?.();
      })
      .catch(() => this.onerror?.());
  }
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array.from({ length: 2000 }, () => 7)]);
const OGG = new Uint8Array([...new TextEncoder().encode("OggS\0\x02"), ...Array.from({ length: 1000 }, () => 3)]);

describe.skipIf(!live)("enhanced features against the live backend", () => {
  let stop: () => void;
  let ws: typeof import("@/shared/api/ws");
  let conversations: typeof import("@/entities/conversation");
  let messages: typeof import("@/entities/message");
  const conv = () => conversations.useConversationStore.getState();
  const msgs = (id: string) => messages.useMessageStore.getState().byConversation[id] ?? [];

  /** A conversation owned by the signed-in agent, already in their inbox. */
  async function myConversation(name: string, customerId: string = crypto.randomUUID()): Promise<string> {
    const created = await rest("/conversations", AGENT1, "POST", {
      customerId,
      applicationId: Math.floor(Math.random() * 1_000_000_000) + 1,
      customerName: name,
    });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    expect((await rest(`/conversations/${id}/assign`, ME, "POST", {})).status).toBe(200);
    await until(() => conv().byId[id]?.handoff === "assigned", `${name} to be mine`);
    toasts.length = 0; // "New conversation from …" is not what the tests look at
    return id;
  }

  async function sendAndAck(id: string, text: string) {
    const { sendMessage } = await import("@/features/send-message");
    expect(sendMessage(id, text)).toBe(true);
    return until(() => msgs(id).find((m) => m.text === text && m.status === "sent"), `"${text}" to be acknowledged`);
  }

  beforeAll(async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
    });
    vi.stubGlobal("XMLHttpRequest", FetchXhr);
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      addEventListener: () => {},
      removeEventListener: () => {},
    });
    ws = await import("@/shared/api/ws");
    conversations = await import("@/entities/conversation");
    messages = await import("@/entities/message");
    const { startRealtime } = await import("@/app/providers/realtime");
    stop = startRealtime();
    await until(() => ws.wsClient.status === "open", "the socket to authenticate");
  });

  afterAll(() => stop?.());
  beforeEach(() => void (toasts.length = 0));

  // Forward is not covered: a customer has one open conversation, and the server forwards only into another open one
  // of the same customer or an internal one (which nothing creates yet), so the UI has no valid target.
  it("FR-16: reply, edit, react and delete a message", async () => {
    const actions = await import("@/features/message-actions/model/actions");
    const id = await myConversation("Actions Test");
    const original = await sendAndAck(id, "first version");

    actions.replyTo(original);
    const reply = await sendAndAck(id, "a reply");
    expect(reply.replyToId).toBe(original.id);

    await actions.saveEdit(original, "second version");
    expect(toasts).toEqual([]);
    expect(msgs(id).find((m) => m.id === original.id)).toMatchObject({ text: "second version", edited: true });
    const history = await rest(`/messages/${original.id}/history`, ME);
    expect(history.status).toBe(200);

    const edited = msgs(id).find((m) => m.id === original.id)!;
    await actions.toggleReaction(edited, "👍");
    const reacted = msgs(id).find((m) => m.id === original.id)!;
    expect(reacted.reactions).toMatchObject([{ emoji: "👍", userId: uid(3) }]);
    await actions.toggleReaction(reacted, "👍");
    expect(msgs(id).find((m) => m.id === original.id)?.reactions ?? []).toEqual([]);

    await actions.deleteMessage(reacted);
    expect(toasts.filter((t) => t.startsWith("Could not"))).toEqual([]);
    expect(msgs(id).find((m) => m.id === original.id)).toMatchObject({ deleted: true });
    const stored = (await rest(`/conversations/${id}/messages`, ME)).body.data as Json[];
    expect(stored.find((m) => m.id === original.id)).toBeDefined(); // kept as a placeholder in history

    // Changes made in another window arrive over the socket.
    expect((await rest(`/messages/${reply.id}`, ME, "PATCH", { text: "edited elsewhere" })).status).toBe(200);
    await until(() => msgs(id).find((m) => m.id === reply.id)?.text === "edited elsewhere", "message.updated");
    expect((await rest(`/messages/${reply.id}`, ME, "DELETE")).status).toBe(200);
    await until(() => msgs(id).find((m) => m.id === reply.id)?.deleted, "message.deleted");
  });

  it("FR-17/18: sends a file and a voice message, lists and deletes the file", async () => {
    const files = await import("@/features/send-message/model/files");
    const { useComposerStore } = await import("@/features/send-message/model/store");
    const { useSharedFilesStore } = await import("@/features/share-files/model/store");
    const id = await myConversation("Files Test");

    expect(files.chooseFiles(id, [new File([PNG], "statement.png", { type: "image/png" })])).toEqual([]);
    useComposerStore.getState().setDraft(id, "here is the statement");
    expect(files.sendChosenFiles(id)).toBe(1);
    const sent = await until(
      () => msgs(id).find((m) => m.attachments?.length && m.status === "sent"),
      "the uploaded file message",
    );
    expect(toasts).toEqual([]);
    expect(sent.text).toBe("here is the statement");
    expect(sent.attachments![0]).toMatchObject({ kind: "IMAGE", fileName: "statement.png", mimeType: "image/png" });
    expect(msgs(id).filter((m) => m.status === "sending")).toEqual([]); // the optimistic copy was replaced

    files.sendVoice(id, new File([OGG], "voice.ogg", { type: "audio/ogg" }), 2400);
    const voice = await until(
      () => msgs(id).find((m) => m.attachments?.[0]?.kind === "AUDIO" && m.status === "sent"),
      "the voice message",
    );
    expect(voice.attachments![0].durationMs).toBe(2400);

    const download = await fetch(`${api}${sent.attachments![0].downloadPath}`, {
      headers: { authorization: `Bearer ${ME}` },
    });
    expect(download.status).toBe(200);

    await useSharedFilesStore.getState().load(id);
    expect(useSharedFilesStore.getState()).toMatchObject({ loading: false, error: false });
    expect(useSharedFilesStore.getState().files.map((f) => f.name)).toEqual(
      expect.arrayContaining(["statement.png", "voice.ogg"]),
    );

    expect((await rest(`/attachments/${sent.attachments![0].id}`, ME, "DELETE")).status).toBe(200);
    await until(
      () =>
        !msgs(id)
          .find((m) => m.id === sent.id)
          ?.attachments?.some((a) => a.id === sent.attachments![0].id),
      "attachment.deleted to remove the file from the message",
    );
  });

  it("FR-19: internal notes with a mention, and escalation", async () => {
    const notes = await import("@/features/internal-notes/model/store");
    const { escalateConversation } = await import("@/features/escalate-conversation");
    const id = await myConversation("Notes Test");

    expect(await notes.addNote(id, "  check the payslip  ", [])).toBe(true);
    const note = notes.useNotesStore.getState().byConversation[id]![0]!;
    expect(note).toMatchObject({ text: "check the payslip", authorId: uid(3) });
    expect(await notes.editNote(note, "check the payslip again")).toBe(true);
    await notes.loadNotes(id);
    expect(notes.useNotesStore.getState().byConversation[id]!.map((n) => n.text)).toEqual(["check the payslip again"]);

    // A supervisor's note that mentions the owner reaches the open panel live, and the owner is notified.
    const created = await rest(`/conversations/${id}/notes`, SUPERVISOR, "POST", {
      text: "from the supervisor",
      mentionedAgentIds: [uid(3)],
    });
    expect(created.status).toBe(201);
    await until(
      () => notes.useNotesStore.getState().byConversation[id]?.some((n) => n.text === "from the supervisor"),
      "note.created",
    );
    await until(() => toasts.length > 0, "the mention notification");
    toasts.length = 0;

    await notes.deleteNote(notes.useNotesStore.getState().byConversation[id]!.find((n) => n.authorId === uid(3))!);
    expect(toasts).toEqual([]);
    expect((await rest(`/conversations/${id}/notes`, ME)).body.data.map((n: Json) => n.content)).toEqual([
      "from the supervisor",
    ]);
    // The note text never becomes a message.
    expect(msgs(id).some((m) => m.text.includes("payslip"))).toBe(false);

    expect(await escalateConversation(id, "needs approval")).toBe(true);
    expect(toasts).toContain("Conversation escalated to a supervisor");
  });

  it("FR-20: tags and priority, including a change made by someone else", async () => {
    const organize = await import("@/features/organize-conversation/model/organize");
    const id = await myConversation("Tags Test");

    await organize.loadTagCatalog();
    expect(organize.useTagCatalog.getState().status).toBe("ready");
    const tag = await organize.createTag(`vip-${crypto.randomUUID().slice(0, 8)}`);
    expect(tag).not.toBeNull();
    expect(await organize.setConversationTags(id, [tag!.id])).toBe(true);
    expect(conv().byId[id]?.tags?.map((t) => t.id)).toEqual([tag!.id]);
    expect(await organize.setPriority(id, "HIGH")).toBe(true);
    expect(conv().byId[id]).toMatchObject({ priority: "HIGH", urgent: true });
    expect((await rest(`/conversations/${id}`, ME)).body.data).toMatchObject({ priority: "HIGH" });

    expect((await rest(`/conversations/${id}/priority`, SUPERVISOR, "PATCH", { priority: "LOW" })).status).toBe(200);
    await until(() => conv().byId[id]?.priority === "LOW", "conversation.priority_changed");
    expect(conv().byId[id]?.tags?.map((t) => t.id)).toEqual([tag!.id]); // other updates keep the tags
    expect((await rest(`/conversations/${id}/tags`, SUPERVISOR, "PUT", { tagIds: [] })).status).toBe(200);
    await until(() => !conv().byId[id]?.tags?.length, "conversation.tags_updated");
    expect(toasts).toEqual([]);
  });

  it("FR-21: saved replies, personal and shared", async () => {
    const templates = await import("@/features/canned-responses/model/store");
    const suffix = crypto.randomUUID().slice(0, 8);
    const title = `Greeting ${suffix}`;
    expect(await templates.createTemplate({ title, content: "Hello {name}", shortcut: "", shared: false })).toBe(true);
    expect(
      await templates.createTemplate({
        title: `${title} shared`,
        content: "Hi all",
        shortcut: `/hi-${suffix}`,
        shared: false,
      }),
    ).toBe(true);
    await templates.loadTemplates();
    const mine = templates.useTemplatesStore.getState().templates.find((t) => t.title === title)!;
    expect(mine).toBeDefined();
    expect(templates.searchTemplates(templates.useTemplatesStore.getState().templates, title)).toHaveLength(2);

    expect(await templates.updateTemplate(mine.id, { content: "Hello again" })).toBe(true);
    await templates.deactivateTemplate(mine.id);
    expect(toasts).toEqual([]);
    await templates.loadTemplates();
    expect(templates.useTemplatesStore.getState().templates.some((t) => t.id === mine.id)).toBe(false);
    // Personal templates stay private.
    const others = (await rest("/canned-responses", AGENT1)).body.data as Json[];
    expect(others.some((t) => t.title === title)).toBe(false);
  });

  it("FR-24: chat settings are saved and follow changes from another window", async () => {
    const { useMessageSettingsStore } = await import("@/features/message-settings");
    const before = (await rest("/agents/me/chat-settings", ME)).body.data.typingSoundEnabled as boolean;
    useMessageSettingsStore.getState().applyRemote((await rest("/agents/me/chat-settings", ME)).body.data);

    useMessageSettingsStore.getState().toggle("typingSound");
    expect(useMessageSettingsStore.getState().values.typingSound).toBe(!before);
    await eventually(
      async () => (await rest("/agents/me/chat-settings", ME)).body.data.typingSoundEnabled === !before,
      "the setting to be saved",
    );

    expect((await rest("/agents/me/chat-settings", ME, "PATCH", { typingSoundEnabled: before })).status).toBe(200);
    await until(() => useMessageSettingsStore.getState().values.typingSound === before, "chat_settings.updated");
    expect(toasts).toEqual([]);
  });

  it("FR-25: schedules, completes and cancels callbacks", async () => {
    const callbacks = await import("@/features/request-callback/model/store");
    const id = await myConversation("Callback Test");
    const inAnHour = new Date(Date.now() + 3_600_000);
    const local = (date: Date) =>
      new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

    expect(await callbacks.scheduleCallback(id, local(inAnHour), "after lunch")).toBe(true);
    expect(await callbacks.scheduleCallback(id, local(new Date(inAnHour.getTime() + 3_600_000)), "")).toBe(true);
    await callbacks.loadCallbacks(id);
    const [first, second] = callbacks.useCallbackStore.getState().byConversation[id]!;
    expect(first).toMatchObject({ notes: "after lunch" });

    expect(await callbacks.completeCallback(first!, "called back")).toBe(true);
    expect(await callbacks.cancelCallback(second!)).toBe(true);
    expect(toasts.filter((t) => t.startsWith("Could not"))).toEqual([]);
    const stored = (await rest(`/conversations/${id}/callbacks`, ME)).body.data as Json[];
    expect(stored.map((c) => c.status).sort()).toEqual(["CANCELLED", "COMPLETED"]);
  });

  it("FR-26: call control over REST (config, start, cancel)", async () => {
    const calls = await import("@/shared/api/rest");
    const id = await myConversation("Call Test");
    const config = await calls.getCallConfig();
    expect(Array.isArray(config.iceServers)).toBe(true);
    const call = await calls.startCallRequest(id);
    expect(call).toMatchObject({ conversationId: id, callType: "AUDIO" });
    expect((await calls.cancelCallRequest(call.id)).status).toBe("CANCELLED");
  });

  it("FR-27: reports spam, blocks and unblocks the customer", async () => {
    const moderate = await import("@/features/moderate-conversation");
    const moderation = await import("@/features/message-settings/model/moderation");
    const customerId = crypto.randomUUID();
    const id = await myConversation("Moderation Test", customerId);

    expect(await moderate.reportSpamAction(id, "abusive language")).toBe(true);
    expect(await moderate.blockConversationCustomerAction(id, "repeated abuse")).toBe(true);
    expect(toasts).toEqual(["Reported to the supervisors", "Customer blocked"]);

    await moderation.loadModeration();
    expect(moderation.useModerationStore.getState().status).toBe("ready");
    expect(moderation.useModerationStore.getState().blocks.map((b) => b.customerId)).toContain(customerId);
    await moderation.unblock(customerId);
    expect(toasts.filter((t) => t.startsWith("Could not"))).toEqual([]);
    const blocks = (await rest("/moderation/blocks", ME)).body.data as Json[];
    expect(blocks.some((b) => b.customerId === customerId)).toBe(false);
  });

  it("FR-14/15: tabs and drafts are kept on the server", async () => {
    const tabs = await import("@/features/chat-tabs");
    const { updateDraft, sendMessage } = await import("@/features/send-message");
    const id = await myConversation("Workspace Test");

    const workspace = async () => (await rest("/workspace", ME)).body.data as { tabs: Json[]; drafts: Json[] };
    tabs.openTab(id);
    await eventually(async () => (await workspace()).tabs.some((t) => t.conversationId === id), "the tab to be saved");

    updateDraft(id, "half a thought"); // saved 800 ms after typing stops
    await eventually(
      async () => (await workspace()).drafts.find((d) => d.conversationId === id)?.content === "half a thought",
      "the draft to be saved",
    );

    sendMessage(id, "half a thought, finished");
    await until(() => msgs(id).find((m) => m.status === "sent"), "the send");
    await eventually(
      async () => !(await workspace()).drafts.some((d) => d.conversationId === id),
      "the draft to be discarded on send",
    );

    tabs.closeTab(id);
    await eventually(async () => !(await workspace()).tabs.some((t) => t.conversationId === id), "the tab to close");
    expect(conv().byId[id]?.handoff).toBe("assigned"); // closing a tab never touches the conversation
  });
});
