import { fromPartial } from "@total-typescript/shoehorn";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthClient, AuthContext } from "@shared/auth/auth.types.js";
import { NotFoundError } from "@shared/errors/AppError.js";
import type { Container } from "../../container.js";
import { uid } from "../../__tests__/support/ids.js";
import { WebSocketHandler } from "../websocket.handler.js";
import { ConnectionRegistry, type Connection } from "../websocket.rooms.js";

vi.mock("@config/logger.js", () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));

const customer: AuthContext = { userId: uid(100), role: "CUSTOMER" };
const agent: AuthContext = { userId: uid(1), role: "AGENT" };
const convId = uid(10);

const services = {
  presence: { connect: vi.fn(), disconnect: vi.fn() },
  conversations: {
    getForCustomer: vi.fn(),
    get: vi.fn(),
    requireForCustomer: vi.fn(),
    assertCanType: vi.fn(),
  },
  messages: { receiveFromCustomer: vi.fn(), send: vi.fn() },
  realtime: { typing: vi.fn() },
  assignments: { assign: vi.fn() },
};
const authClient: AuthClient = { verifyToken: vi.fn() };

function setup() {
  const sent: { type: string; payload: any }[] = [];
  const socket = {
    OPEN: 1,
    readyState: 1,
    bufferedAmount: 0,
    close: vi.fn(),
    send: (raw: string) => sent.push(JSON.parse(raw)),
  };
  const connection = {
    id: "conn-1",
    socket,
    typing: new Map(),
    queue: Promise.resolve(),
    rooms: new Set(),
  } as unknown as Connection;
  const handler = new WebSocketHandler(fromPartial<Container>(services), authClient, new ConnectionRegistry());
  const send = async (type: string, payload: unknown) => {
    handler.receive(connection, JSON.stringify({ type, payload }));
    await connection.queue;
  };
  return { connection, sent, send, socket, handler };
}

beforeEach(() => {
  vi.resetAllMocks();
  services.conversations.getForCustomer.mockResolvedValue({ id: convId, lastSequenceNumber: "7" });
  services.conversations.get.mockResolvedValue({ id: convId, lastSequenceNumber: "9" });
  services.conversations.requireForCustomer.mockResolvedValue({});
  services.presence.connect.mockResolvedValue(undefined);
  services.realtime.typing.mockResolvedValue(undefined);
});

describe("customer connection", () => {
  it("authenticates a customer without registering agent presence", async () => {
    vi.mocked(authClient.verifyToken).mockResolvedValue(customer);
    const { send, sent } = setup();
    await send("auth", { token: "t" });
    expect(sent[0]).toMatchObject({ type: "connection.authenticated", payload: { role: "CUSTOMER" } });
    expect(services.presence.connect).not.toHaveBeenCalled();
  });

  it("joins the room of its own conversation and reports where history resumes", async () => {
    const { connection, send, sent } = setup();
    connection.auth = customer;
    await send("room.join", { conversationId: convId });
    expect(services.conversations.getForCustomer).toHaveBeenCalledWith(customer.userId, convId);
    expect(sent).toEqual([{ type: "room.joined", payload: { conversationId: convId, lastSequenceNumber: "7" } }]);
    expect(connection.rooms.has(convId)).toBe(true);
  });

  it("answers room.error, and does not join, for a conversation that is not theirs", async () => {
    services.conversations.getForCustomer.mockRejectedValue(new NotFoundError("Conversation not found"));
    const { connection, send, sent } = setup();
    connection.auth = customer;
    await send("room.join", { conversationId: convId });
    expect(sent[0]).toMatchObject({
      type: "room.error",
      payload: { event: "room.join", conversationId: convId, code: "NOT_FOUND" },
    });
    expect(connection.rooms.size).toBe(0);
  });

  it("leaves a room", async () => {
    const { connection, send, sent } = setup();
    connection.auth = customer;
    connection.rooms.add(convId);
    await send("room.leave", { conversationId: convId });
    expect(sent[0]).toEqual({ type: "room.left", payload: { conversationId: convId } });
    expect(connection.rooms.size).toBe(0);
  });

  it("persists a sent message through the customer service and acks only the sender", async () => {
    services.messages.receiveFromCustomer.mockResolvedValue({
      created: true,
      message: { id: uid(50), clientId: "c1", metadata: { x: 1 } },
    });
    const { connection, send, sent } = setup();
    connection.auth = customer;
    await send("message.send", { conversationId: convId, clientId: "c1", text: "hi" });
    expect(services.messages.receiveFromCustomer).toHaveBeenCalledWith({
      customerId: customer.userId,
      conversationId: convId,
      clientId: "c1",
      text: "hi",
      origin: "conn-1",
    });
    expect(services.messages.send).not.toHaveBeenCalled();
    expect(sent[0]).toMatchObject({
      type: "message.ack",
      payload: { clientId: "c1", created: true, message: { metadata: null } },
    });
  });

  it("reports a failed send with its clientId", async () => {
    services.messages.receiveFromCustomer.mockRejectedValue(new NotFoundError("Conversation not found"));
    const { connection, send, sent } = setup();
    connection.auth = customer;
    await send("message.send", { conversationId: convId, clientId: "c1", text: "hi" });
    expect(sent[0]).toMatchObject({ type: "message.failed", payload: { clientId: "c1", code: "NOT_FOUND" } });
  });

  it("sends typing as the customer side, and never lets a customer run staff commands", async () => {
    const { connection, send, sent } = setup();
    connection.auth = customer;
    await send("typing.start", { conversationId: convId });
    expect(services.conversations.requireForCustomer).toHaveBeenCalledWith(customer.userId, convId);
    expect(services.conversations.assertCanType).not.toHaveBeenCalled();
    expect(services.realtime.typing).toHaveBeenCalledWith(convId, customer.userId, true, "conn-1", "customer");
    connection.typing.forEach((timer) => clearTimeout(timer));

    await send("conversation.takeover", { conversationId: convId });
    expect(services.assignments.assign).not.toHaveBeenCalled();
    expect(sent.at(-1)).toMatchObject({
      type: "error",
      payload: { code: "FORBIDDEN", event: "conversation.takeover" },
    });
  });
});

describe("agent connection", () => {
  it("joins a room after the staff access check, and still sends as an agent", async () => {
    services.messages.send.mockResolvedValue({ created: true, message: { clientId: "c1" } });
    const { connection, send, sent } = setup();
    connection.auth = agent;
    await send("room.join", { conversationId: convId });
    expect(services.conversations.get).toHaveBeenCalledWith(agent, convId);
    expect(sent[0]).toEqual({ type: "room.joined", payload: { conversationId: convId, lastSequenceNumber: "9" } });
    await send("message.send", { conversationId: convId, clientId: "c1", text: "hi" });
    expect(services.messages.send).toHaveBeenCalled();
    expect(services.messages.receiveFromCustomer).not.toHaveBeenCalled();
  });
});
