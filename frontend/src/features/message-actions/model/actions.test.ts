import { beforeEach, describe, expect, it, vi } from "vitest";

const rest = vi.hoisted(() => ({
  deleteMessageRequest: vi.fn(),
  editMessageRequest: vi.fn(),
  forwardRequest: vi.fn(),
  reactRequest: vi.fn(),
  unreactRequest: vi.fn(),
}));
vi.mock("@/shared/api/rest", () => rest);
vi.mock("@/shared/ui", () => ({ notify: vi.fn() }));

import { useMessageStore, type ChatMessage } from "@/entities/message";
import { useSessionStore } from "@/shared/api/session";
import { availableActions, deleteMessage, saveEdit, toggleReaction, useEditingStore } from "./actions";

const message = (patch: Partial<ChatMessage> = {}): ChatMessage => ({
  id: "m1",
  conversationId: "a",
  side: "agent",
  text: "hello",
  createdAt: "2026-01-01T09:00:00Z",
  status: "sent",
  senderId: "me",
  ...patch,
});
const backend = (patch = {}) => ({
  id: "m1",
  conversationId: "a",
  clientId: null,
  sequenceNumber: "1",
  senderType: "AGENT",
  senderId: "me",
  type: "TEXT",
  content: "hello there",
  status: "SENT",
  createdAt: "2026-01-01T09:00:00Z",
  isEdited: true,
  ...patch,
});

beforeEach(() => {
  vi.clearAllMocks();
  useSessionStore.setState({ userId: "me", role: "AGENT" });
  useMessageStore.setState({ byConversation: { a: [message()] }, typing: {}, history: {}, replyTarget: {} });
  useEditingStore.setState({ editingId: null });
});

describe("availableActions", () => {
  it("lets agents edit and delete only their own stored messages", () => {
    expect(availableActions(message())).toMatchObject({ edit: true, remove: true, reply: true, react: true });
    expect(availableActions(message({ senderId: "other" }))).toMatchObject({ edit: false, remove: false, reply: true });
    expect(availableActions(message({ side: "customer", senderId: "c" }))).toMatchObject({
      edit: false,
      remove: false,
    });
    expect(availableActions(message({ status: "sending" }))).toMatchObject({ edit: false, reply: false, copy: true });
  });

  it("offers nothing on a deleted message", () => {
    useSessionStore.setState({ userId: "me", role: "SUPERVISOR" });
    expect(availableActions(message({ deleted: true, text: "" }))).toEqual({
      reply: false,
      react: false,
      forward: false,
      copy: false,
      edit: false,
      remove: false,
    });
  });

  it("lets supervisors delete others' messages but nothing on system notes", () => {
    useSessionStore.setState({ userId: "boss", role: "SUPERVISOR" });
    expect(availableActions(message({ side: "customer", senderId: "c" }))).toMatchObject({ remove: true, edit: false });
    expect(availableActions(message({ side: "system" }))).toMatchObject({ remove: false, reply: false, copy: false });
  });

  it("offers forward only for text messages, since the server refuses files and voice (400)", () => {
    const file = {
      id: "f1",
      kind: "IMAGE" as const,
      fileName: "a.png",
      mimeType: "image/png",
      size: 1,
      downloadPath: "/x",
    };
    expect(availableActions(message()).forward).toBe(true);
    expect(availableActions(message({ attachments: [file] })).forward).toBe(false);
    expect(availableActions(message({ text: "", attachments: [] })).forward).toBe(false);
  });
});

describe("actions", () => {
  it("replaces the message with the server's edited copy and leaves edit mode", async () => {
    useEditingStore.setState({ editingId: "m1" });
    rest.editMessageRequest.mockResolvedValue(backend());
    await saveEdit(message(), "  hello there ");
    expect(rest.editMessageRequest).toHaveBeenCalledWith("m1", "hello there");
    expect(useMessageStore.getState().byConversation.a?.[0]).toMatchObject({ text: "hello there", edited: true });
    expect(useEditingStore.getState().editingId).toBeNull();
  });

  it("does not call the server for an unchanged or blank edit", async () => {
    await saveEdit(message(), "hello");
    await saveEdit(message(), "   ");
    expect(rest.editMessageRequest).not.toHaveBeenCalled();
  });

  it("keeps the message and edit mode when the server refuses", async () => {
    useEditingStore.setState({ editingId: "m1" });
    rest.editMessageRequest.mockRejectedValue(new Error("You can only edit your own messages"));
    await saveEdit(message(), "new");
    expect(useMessageStore.getState().byConversation.a?.[0]?.text).toBe("hello");
    expect(useEditingStore.getState().editingId).toBe("m1");
  });

  it("marks a message deleted only after the server confirms", async () => {
    rest.deleteMessageRequest.mockRejectedValueOnce(new Error("no"));
    await deleteMessage(message());
    expect(useMessageStore.getState().byConversation.a?.[0]).toMatchObject({ text: "hello" });
    rest.deleteMessageRequest.mockResolvedValueOnce({});
    await deleteMessage(message());
    expect(useMessageStore.getState().byConversation.a?.[0]).toMatchObject({ id: "m1", text: "", deleted: true });
  });

  it("adds a reaction, and removes it when the caller already reacted with that emoji", async () => {
    rest.reactRequest.mockResolvedValue({
      reactions: [{ id: "r1", userType: "AGENT", userId: "me", emoji: "👍", createdAt: "t" }],
    });
    await toggleReaction(message(), "👍");
    expect(rest.reactRequest).toHaveBeenCalledWith("m1", "👍");
    expect(useMessageStore.getState().byConversation.a?.[0]?.reactions).toEqual([
      { id: "r1", userId: "me", emoji: "👍" },
    ]);

    rest.unreactRequest.mockResolvedValue({ reactions: [] });
    await toggleReaction(useMessageStore.getState().byConversation.a![0]!, "👍");
    expect(rest.unreactRequest).toHaveBeenCalledWith("m1", "r1");
    expect(useMessageStore.getState().byConversation.a?.[0]?.reactions).toEqual([]);
  });
});
