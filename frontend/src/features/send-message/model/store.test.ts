import { beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.hoisted(() => vi.fn());
vi.mock("@/shared/api/ws", () => ({ wsClient: { send } }));

import { useMessageStore } from "@/entities/message";
import { retryMessage, sendMessage, useComposerStore } from "./store";

beforeEach(() => {
  send.mockClear();
  useMessageStore.setState({ byConversation: {}, typing: {} });
  useComposerStore.setState({ drafts: {}, attachments: {}, recording: false });
});

describe("sendMessage", () => {
  it("ignores blank text", () => {
    expect(sendMessage("a", "   ")).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(useMessageStore.getState().byConversation.a).toBeUndefined();
  });

  it("appends an optimistic message and sends the same client id", () => {
    expect(sendMessage("a", "  hello  ")).toBe(true);
    const [message] = useMessageStore.getState().byConversation.a;
    expect(message).toMatchObject({ side: "agent", text: "hello", status: "sending" });
    expect(send).toHaveBeenCalledWith("message.send", { conversationId: "a", clientId: message.id, text: "hello" });
  });

  it("clears the draft and attachment of that conversation only", () => {
    const composer = useComposerStore.getState();
    composer.setDraft("a", "hello");
    composer.setDraft("b", "keep me");
    composer.setAttachment("a", "a.pdf");
    composer.setAttachment("b", "b.pdf");
    sendMessage("a", "hello");
    expect(useComposerStore.getState().drafts).toMatchObject({ a: "", b: "keep me" });
    expect(useComposerStore.getState().attachments).toMatchObject({ a: "", b: "b.pdf" });
  });
});

describe("retryMessage", () => {
  it("re-sends a failed message with the same client id and marks it sending", () => {
    useMessageStore.getState().upsert({
      id: "c-1",
      conversationId: "a",
      side: "agent",
      text: "hello",
      createdAt: new Date().toISOString(),
      status: "failed",
    });
    expect(retryMessage("a", "c-1")).toBe(true);
    expect(useMessageStore.getState().byConversation.a[0].status).toBe("sending");
    expect(send).toHaveBeenCalledWith("message.send", { conversationId: "a", clientId: "c-1", text: "hello" });
  });

  it("ignores messages that did not fail", () => {
    sendMessage("a", "hello");
    send.mockClear();
    const [message] = useMessageStore.getState().byConversation.a;
    expect(retryMessage("a", message.id)).toBe(false);
    expect(retryMessage("a", "missing")).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});
