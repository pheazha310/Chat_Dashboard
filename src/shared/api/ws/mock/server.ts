import type { ChatMessageDto, ConversationDto, Envelope, ServerEventMap } from "../protocol";
import type { ClientEventMap } from "../protocol";
import { seedConversations, seedMessages } from "./seed";

type Send = <K extends keyof ServerEventMap>(type: K, payload: ServerEventMap[K]) => void;

export interface MockConnection {
  push: Send;
}

const CUSTOMER_REPLIES = [
  "Thank you, I'll wait for your confirmation.",
  "Understood. Is there anything I need to prepare?",
  "Okay, thanks for the quick update!",
  "Can you confirm once the new date is saved?",
];

const INCOMING = [
  "Hello? Is anyone available to help me?",
  "I just uploaded my documents, can you check?",
  "When will my loan be disbursed?",
  "Can I pay my installment early?",
];

const pick = <T>(items: T[]) => items[Math.floor(Math.random() * items.length)];
const nowIso = () => new Date().toISOString();

/** In-memory stand-in for the lending chat backend. Lives for the page lifetime so reconnects keep state. */
export class MockLendingServer {
  private conversations = seedConversations();
  private messages = seedMessages(this.conversations);
  private connections = new Set<MockConnection>();
  private ticker: number | undefined;
  private counter = 0;

  attach(connection: MockConnection) {
    this.connections.add(connection);
    this.ticker ??= window.setInterval(() => this.simulateIncoming(), 20_000);
  }

  detach(connection: MockConnection) {
    this.connections.delete(connection);
    if (this.connections.size === 0) {
      window.clearInterval(this.ticker);
      this.ticker = undefined;
    }
  }

  receive(frame: Envelope) {
    const { type, payload } = frame as {
      [K in keyof ClientEventMap]: Envelope<K, ClientEventMap[K]>;
    }[keyof ClientEventMap];
    switch (type) {
      case "sync.request":
        return this.broadcast("sync", {
          conversations: this.conversations,
          messages: this.messages,
        });
      case "message.send":
        return this.handleSend(payload.conversationId, payload.clientId, payload.text);
      case "conversation.read":
        return this.update(payload.conversationId, { unread: 0 });
      case "conversation.takeover":
        this.update(payload.conversationId, { handoff: "assigned", unread: 0 });
        return this.broadcast("notice", {
          text: "Conversation assigned to you",
        });
      case "callback.request": {
        const conversation = this.find(payload.conversationId);
        return this.broadcast("notice", {
          text: `Callback request sent to ${conversation?.name.split(" ")[0]}`,
        });
      }
    }
  }

  private broadcast: Send = (type, payload) => this.connections.forEach((connection) => connection.push(type, payload));

  private find(id: string) {
    return this.conversations.find((conversation) => conversation.id === id);
  }

  private update(id: string, patch: Partial<ConversationDto>) {
    const conversation = this.find(id);
    if (!conversation) return;
    Object.assign(conversation, patch);
    this.broadcast("conversation.updated", {
      conversation: { ...conversation },
    });
  }

  private addMessage(message: ChatMessageDto) {
    (this.messages[message.conversationId] ??= []).push(message);
    return message;
  }

  private later(ms: number, task: () => void) {
    window.setTimeout(task, ms);
  }

  private handleSend(conversationId: string, clientId: string, text: string) {
    const conversation = this.find(conversationId);
    if (!conversation) return;

    const message = this.addMessage({
      id: clientId,
      conversationId,
      side: "agent",
      text,
      createdAt: nowIso(),
      status: "sent",
    });
    this.broadcast("message.ack", { message });
    this.update(conversationId, {
      preview: text,
      lastMessageAt: message.createdAt,
      handoff: conversation.handoff === "needs-human" ? "assigned" : conversation.handoff,
    });

    const setStatus = (status: "delivered" | "read") => {
      const stored = this.messages[conversationId].find((item) => item.id === clientId);
      if (stored) stored.status = status;
      this.broadcast("message.status", {
        conversationId,
        messageId: clientId,
        status,
      });
    };
    this.later(600, () => setStatus("delivered"));
    this.later(1600, () => setStatus("read"));
    this.later(2200, () =>
      this.broadcast("typing", {
        conversationId,
        side: "customer",
        active: true,
      }),
    );
    this.later(4200, () => {
      this.broadcast("typing", {
        conversationId,
        side: "customer",
        active: false,
      });
      this.customerSays(conversationId, pick(CUSTOMER_REPLIES));
    });
  }

  private customerSays(conversationId: string, text: string) {
    const conversation = this.find(conversationId);
    if (!conversation) return;
    const message = this.addMessage({
      id: `srv-${++this.counter}-${Date.now()}`,
      conversationId,
      side: "customer",
      text,
      createdAt: nowIso(),
      status: "sent",
    });
    this.broadcast("message.new", { message });
    this.update(conversationId, {
      preview: text,
      lastMessageAt: message.createdAt,
      unread: conversation.unread + 1,
    });
  }

  private simulateIncoming() {
    this.customerSays(pick(this.conversations).id, pick(INCOMING));
  }
}
