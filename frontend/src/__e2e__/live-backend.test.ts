import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The frontend's real stack (BackendSocket, WsClient, startRealtime, stores, feature actions) against a running
 * backend. Skipped unless all three are set; see docs/frontend-integration.md ("Verifying against the backend").
 *
 *   VITE_WS_URL=ws://127.0.0.1:4555/ws VITE_AUTH_TOKEN=dev:00000000-0000-4000-8000-000000000003:AGENT LIVE_API_URL=http://127.0.0.1:4555/api/v1/admin pnpm test
 *
 * The backend must run with a throwaway database. The test creates its own conversations (unique application ids)
 * and acts as agent 3; other people (the customer's agent 1, a supervisor, agent 4) act through REST.
 */
const api = process.env.LIVE_API_URL;
const live = Boolean(api && process.env.VITE_WS_URL && process.env.VITE_AUTH_TOKEN);

const toasts = vi.hoisted(() => [] as string[]);
vi.mock("@/shared/ui", () => ({ notify: (text: string) => void toasts.push(text) }));

type Json = Record<string, any>;
const rest = async (
  path: string,
  token: string,
  method = "GET",
  body?: unknown,
): Promise<{ status: number; body: Json }> => {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: (await response.json()) as Json };
};
/** Deterministic UUID for the dev agents (the backend ids are UUIDs): uid(3) is 00000000-0000-4000-8000-000000000003. */
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const AGENT1 = `dev:${uid(1)}:AGENT`;
const ME = `dev:${uid(3)}:AGENT`; // the signed-in agent in this test (VITE_AUTH_TOKEN)
const AGENT4 = `dev:${uid(4)}:AGENT`;
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

async function newConversation(name: string): Promise<string> {
  const created = await rest("/conversations", AGENT1, "POST", {
    customerId: crypto.randomUUID(),
    applicationId: Math.floor(Math.random() * 1_000_000_000) + 1,
    customerName: name,
    priority: "HIGH",
  });
  expect(created.status).toBe(201);
  return created.body.data.id as string;
}

describe.skipIf(!live)("frontend against the live backend", () => {
  let stop: () => void;
  let ws: typeof import("@/shared/api/ws");
  let conversations: typeof import("@/entities/conversation");
  let messages: typeof import("@/entities/message");
  let session: typeof import("@/shared/api/session");
  const conv = () => conversations.useConversationStore.getState();
  const msgs = (id: string) => messages.useMessageStore.getState().byConversation[id] ?? [];

  beforeAll(async () => {
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      addEventListener: () => {},
      removeEventListener: () => {},
    });
    ws = await import("@/shared/api/ws");
    conversations = await import("@/entities/conversation");
    messages = await import("@/entities/message");
    session = await import("@/shared/api/session");
    const { startRealtime } = await import("@/app/providers/realtime");
    stop = startRealtime();
    await until(() => ws.wsClient.status === "open", "the socket to authenticate");
  });

  afterAll(() => stop?.());

  it("uses the real transport and knows who is signed in", () => {
    expect(ws.isMockTransport).toBe(false);
    expect(session.useSessionStore.getState()).toMatchObject({ userId: uid(3), role: "AGENT" });
  });

  it("shows a conversation created elsewhere in the inbox, with the right mapping", async () => {
    const id = await newConversation("Dara Sok");
    const shown = await until(() => conv().byId[id], "the new conversation to appear");
    expect(shown).toMatchObject({
      name: "Dara Sok",
      urgent: true,
      handoff: "needs-human",
      unread: 0,
      application: { status: "Unknown", product: "—" },
    });
    expect(shown.avatar).toMatch(/^data:image/);
    expect(conv().order[0]).toBe(id);
    expect(toasts).toContain("New conversation from Dara Sok");
  });

  it("takes over, sends a message that the server acknowledges, and keeps history consistent", async () => {
    const { takeOverConversation } = await import("@/features/take-over-conversation");
    const { sendMessage } = await import("@/features/send-message");
    const id = await newConversation("Takeover Test");
    await until(() => conv().byId[id], "conversation");

    takeOverConversation(id);
    await until(() => conv().byId[id]?.handoff === "assigned", "the takeover to be confirmed");
    expect(conv().byId[id]?.assignedAgent).toMatchObject({ id: uid(3), name: `Agent ${uid(3)}` });
    const note = await until(() => msgs(id).find((m) => m.side === "system"), "the system message");
    expect(note.text).toBe(`Agent ${uid(3)} took over the conversation`);

    expect(sendMessage(id, "  Hello Dara  ")).toBe(true);
    const sent = msgs(id).find((m) => m.side === "agent")!;
    expect(sent).toMatchObject({ status: "sending", text: "Hello Dara" });
    const acked = await until(() => msgs(id).find((m) => m.side === "agent" && m.status !== "sending"), "the ack");
    expect(acked.id).not.toBe(sent.id); // the optimistic id was replaced by the server's
    expect(acked).toMatchObject({ status: "sent", clientId: sent.id });
    expect(msgs(id).filter((m) => m.side === "agent")).toHaveLength(1);
    expect(conv().byId[id]?.preview).toBe("Hello Dara");

    // The same message from the REST history: once, in the same order.
    const history = await rest(`/conversations/${id}/messages`, ME);
    expect(history.body.data.map((m: Json) => m.content)).toEqual([
      `Agent ${uid(3)} took over the conversation`,
      "Hello Dara",
    ]);
    expect(msgs(id).map((m) => m.text)).toEqual([`Agent ${uid(3)} took over the conversation`, "Hello Dara"]);
  });

  it("loads history when a conversation is opened and pages back", async () => {
    const { selectConversation } = await import("@/features/select-conversation");
    const id = await newConversation("History Test");
    await until(() => conv().byId[id], "conversation");
    await rest(`/conversations/${id}/assign`, ME, "POST", {});
    for (let n = 1; n <= 55; n++)
      await rest(`/conversations/${id}/messages`, ME, "POST", { clientId: `h-${id}-${n}`, text: `line ${n}` });

    messages.useMessageStore.setState((s) => ({
      byConversation: { ...s.byConversation, [id]: [] },
      history: { ...s.history, [id]: undefined as never },
    }));
    selectConversation(id);
    await until(() => messages.useMessageStore.getState().history[id]?.loaded, "history to load");
    const first = msgs(id);
    expect(first).toHaveLength(50);
    expect(first.at(-1)?.text).toBe("line 55");
    expect(messages.useMessageStore.getState().history[id]?.hasMore).toBe(true);

    await messages.loadOlderMessages(id);
    expect(msgs(id)).toHaveLength(56); // 55 lines + the takeover note, no duplicates
    expect(new Set(msgs(id).map((m) => m.id)).size).toBe(msgs(id).length);
    const sequences = msgs(id).map((m) => BigInt(m.sequence!));
    expect(sequences).toEqual([...sequences].sort((a, b) => (a < b ? -1 : 1)));
    expect(messages.useMessageStore.getState().history[id]?.hasMore).toBe(false);
    expect(conv().byId[id]?.activity.length).toBeGreaterThan(0); // details loaded on selection
  });

  it("marks a send from a non-owner as failed with the server's reason", async () => {
    const { sendMessage } = await import("@/features/send-message");
    const id = await newConversation("Not Mine");
    await until(() => conv().byId[id], "conversation");
    toasts.length = 0;
    sendMessage(id, "I should not be able to send this");
    const failed = await until(() => msgs(id).find((m) => m.status === "failed"), "the failure");
    expect(failed.text).toBe("I should not be able to send this");
    expect(toasts).toContain("Only the agent who owns an open conversation can send messages");
    expect((await rest(`/conversations/${id}/messages`, ME)).body.data).toEqual([]);
  });

  it("keeps unread in step: mark unread, then reading clears it everywhere", async () => {
    const { markConversationUnread } = await import("@/features/mark-unread");
    const { selectConversation } = await import("@/features/select-conversation");
    const id = await newConversation("Unread Test");
    await until(() => conv().byId[id], "conversation");
    await rest(`/conversations/${id}/assign`, ME, "POST", {});
    await until(() => conv().byId[id]?.handoff === "assigned", "assignment");

    markConversationUnread(id);
    expect(conv().byId[id]?.unread).toBe(1);
    await until(
      async () => (await rest(`/conversations/${id}`, ME)).body.data.unreadCount === 1,
      "server to store it",
    ).catch(() => undefined);
    const stored = await rest(`/conversations/${id}`, ME);
    expect(stored.body.data.unreadCount).toBe(1);

    selectConversation(id);
    expect(conv().byId[id]?.unread).toBe(0);
    await until(
      async () => (await rest(`/conversations/${id}`, ME)).body.data.unreadCount === 0,
      "server to clear it",
    ).catch(() => undefined);
    expect((await rest(`/conversations/${id}`, ME)).body.data.unreadCount).toBe(0);
  });

  it("removes a conversation that is transferred to another agent", async () => {
    const id = await newConversation("Transfer Test");
    await until(() => conv().byId[id], "conversation");
    await rest(`/conversations/${id}/assign`, ME, "POST", {});
    await until(() => conv().byId[id]?.handoff === "assigned", "assignment");
    toasts.length = 0;

    expect((await rest(`/conversations/${id}/transfer`, SUPERVISOR, "POST", { agentId: uid(4) })).status).toBe(200);
    await until(() => conv().byId[id] === undefined, "the conversation to leave the inbox");
    // The dev directory names agents "Agent <id>", and ids are UUIDs since the UUID migration.
    expect(toasts).toContain(`Conversation moved to Agent ${uid(4)}`);
    // The notification is its own event and may land just after the removal.
    await until(() => toasts.some((t) => t.includes("transferred away from you")), "the notification");
    expect(conv().order).not.toContain(id);
  });

  it("takes over a waiting conversation another agent claimed first and explains", async () => {
    const { takeOverConversation } = await import("@/features/take-over-conversation");
    const id = await newConversation("Race Test");
    await until(() => conv().byId[id], "conversation");
    expect((await rest(`/conversations/${id}/assign`, AGENT4, "POST", {})).status).toBe(200);
    await until(() => conv().byId[id] === undefined, "it to disappear for us");
    toasts.length = 0;
    takeOverConversation(id);
    await until(() => toasts.length > 0, "an explanation");
    expect(conv().byId[id]).toBeUndefined();
  });

  it("archives and restores through the backend", async () => {
    const { archiveConversation, restoreConversation } = await import("@/features/archive-conversation");
    const id = await newConversation("Archive Test");
    await until(() => conv().byId[id], "conversation");

    expect(await archiveConversation(id)).toBe(true);
    expect(conv().byId[id]?.archived).toBe(true);
    const archived = await rest("/conversations?filter=archived", ME);
    expect(archived.body.data.map((c: Json) => c.id)).toContain(id);

    await conversations.loadArchived();
    expect(conv().byId[id]?.archived).toBe(true);
    expect(await restoreConversation(id)).toBe(true);
    expect((await rest(`/conversations/${id}`, ME)).body.data.isArchived).toBe(false);
  });

  it("shows notifications as they happen", async () => {
    const id = await newConversation("Notify Test");
    await until(() => conv().byId[id], "conversation");
    toasts.length = 0;
    await rest(`/conversations/${id}/assign`, SUPERVISOR, "POST", { agentId: uid(3) });
    await until(() => toasts.some((t) => t.includes("A conversation was assigned to you")), "the notification toast");
  });

  it("after a reconnect, brings back exactly the messages that were missed", async () => {
    const id = await newConversation("Reconnect Test");
    await until(() => conv().byId[id], "conversation");
    await rest(`/conversations/${id}/assign`, ME, "POST", {});
    await until(() => conv().byId[id]?.handoff === "assigned", "assignment");
    await rest(`/conversations/${id}/messages`, ME, "POST", { clientId: `r-${id}-0`, text: "before" });
    await until(() => msgs(id).some((m) => m.text === "before"), "the first message");
    const before = msgs(id).length;

    ws.wsClient.disconnect();
    await until(() => ws.wsClient.status === "idle", "disconnect");
    await rest(`/conversations/${id}/messages`, ME, "POST", { clientId: `r-${id}-1`, text: "missed one" });
    await rest(`/conversations/${id}/messages`, ME, "POST", { clientId: `r-${id}-2`, text: "missed two" });
    expect(msgs(id)).toHaveLength(before);

    ws.wsClient.connect();
    await until(() => msgs(id).some((m) => m.text === "missed two"), "the missed messages after reconnecting");
    expect(
      msgs(id)
        .map((m) => m.text)
        .slice(-3),
    ).toEqual(["before", "missed one", "missed two"]);
    expect(new Set(msgs(id).map((m) => m.id)).size).toBe(msgs(id).length);
    expect(conv().byId[id]).toBeDefined();
  });
});
