import { describe, expect, it, vi } from "vitest";
import { CustomerChannelService } from "../customer-channel.service.js";
import { chatSendBody, mineHistoryQuery } from "../customer-channel.schema.js";

describe("chatSendBody", () => {
  it("accepts a text message", () => {
    const body = chatSendBody.parse({ clientMessageId: "c1", type: "TEXT", text: " hi " });
    expect(body).toMatchObject({ clientId: "c1", type: "TEXT", text: "hi" });
  });
  it("defaults the type to TEXT and needs text for it", () => {
    expect(chatSendBody.parse({ clientMessageId: "c1", text: "x" }).type).toBe("TEXT");
    expect(chatSendBody.safeParse({ clientMessageId: "c1", type: "TEXT" }).success).toBe(false);
  });
  it("needs an attachmentId for FILE, with an optional caption", () => {
    expect(chatSendBody.safeParse({ clientMessageId: "c1", type: "FILE" }).success).toBe(false);
    const id = "11111111-1111-4111-8111-111111111111";
    expect(chatSendBody.parse({ clientMessageId: "c1", type: "FILE", attachmentId: id }).attachmentId).toBe(id);
  });
});

describe("mineHistoryQuery", () => {
  it("reads size as the page size", () => {
    expect(mineHistoryQuery.parse({ size: "30" }).limit).toBe(30);
  });
});

describe("CustomerChannelService, the customer's one conversation", () => {
  const conversation = { id: "conv-1" };
  const build = () => {
    const conversations = {
      joinForCustomer: vi.fn().mockResolvedValue({ conversation, created: false }),
      requireForCustomer: vi.fn().mockResolvedValue(undefined),
    };
    const messages = {
      receiveFromCustomer: vi.fn().mockResolvedValue({ message: { id: "m1" }, created: true }),
      historyForCustomer: vi.fn().mockResolvedValue({ items: [], meta: {} }),
    };
    const attachments = { sendStagedFromCustomer: vi.fn().mockResolvedValue({ message: { id: "m2" }, created: true }) };
    const service = new CustomerChannelService(
      conversations as never,
      messages as never,
      attachments as never,
      {} as never,
    );
    return { service, conversations, messages, attachments };
  };

  it("finds or creates the conversation", async () => {
    const { service, conversations } = build();
    expect(await service.mine("cust")).toBe(conversation);
    expect(conversations.joinForCustomer).toHaveBeenCalledWith("cust", {});
  });

  it("sends text into it", async () => {
    const { service, messages } = build();
    await service.sendToMine("cust", { clientId: "c1", type: "TEXT", text: "hi" });
    expect(messages.receiveFromCustomer).toHaveBeenCalledWith({
      customerId: "cust",
      conversationId: "conv-1",
      clientId: "c1",
      text: "hi",
    });
  });

  it("sends a staged file into it", async () => {
    const { service, attachments } = build();
    await service.sendToMine("cust", { clientId: "c1", type: "FILE", attachmentId: "a1", text: "payslip" });
    expect(attachments.sendStagedFromCustomer).toHaveBeenCalledWith("cust", "conv-1", {
      clientId: "c1",
      attachmentId: "a1",
      text: "payslip",
    });
  });

  it("reads its history", async () => {
    const { service, messages } = build();
    await service.historyOfMine("cust", { limit: 30 });
    expect(messages.historyForCustomer).toHaveBeenCalledWith("conv-1", { limit: 30 });
  });
});
