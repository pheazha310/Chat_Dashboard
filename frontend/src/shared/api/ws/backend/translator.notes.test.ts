import { describe, expect, it } from "vitest";
import { BackendTranslator } from "./translator";

const backendNote = {
  id: "n1",
  conversationId: "a",
  authorAgentId: "u",
  author: { id: "u", name: "Sarah", avatarUrl: null },
  content: "hi",
  mentionedAgentIds: ["x"],
  isEdited: true,
  createdAt: "2026-01-01T09:00:00Z",
};

describe("BackendTranslator notes and escalations", () => {
  const translator = new BackendTranslator();

  it("maps note events", () => {
    expect(translator.fromBackend({ type: "note.created", payload: { note: backendNote } })).toEqual([
      {
        type: "note.created",
        payload: {
          note: {
            id: "n1",
            conversationId: "a",
            authorId: "u",
            authorName: "Sarah",
            text: "hi",
            mentionedAgentIds: ["x"],
            edited: true,
            createdAt: "2026-01-01T09:00:00Z",
          },
        },
      },
    ]);
    expect(translator.fromBackend({ type: "note.deleted", payload: { id: "n1", conversationId: "a" } })).toEqual([
      { type: "note.deleted", payload: { conversationId: "a", noteId: "n1" } },
    ]);
  });

  it("maps an escalation and ignores the private mention event", () => {
    const frames = translator.fromBackend({
      type: "conversation.escalated",
      payload: { escalation: { id: "e1", conversationId: "a", status: "PENDING", requestedBy: "u", reason: "upset" } },
    });
    expect(frames).toEqual([
      {
        type: "conversation.escalated",
        payload: { conversationId: "a", escalationId: "e1", status: "PENDING", requestedBy: "u", reason: "upset" },
      },
    ]);
    expect(translator.fromBackend({ type: "note.mentioned", payload: { noteId: "n1" } })).toEqual([]);
  });
});

describe("BackendTranslator priority and tags", () => {
  const translator = new BackendTranslator();
  const conversation = {
    id: "a",
    customerId: "c",
    customerName: "Maya",
    applicationId: null,
    status: "OPEN",
    priority: "HIGH",
    conversationMode: "HUMAN",
    handoffStatus: "ASSIGNED",
    assignedAgentId: null,
    assignedAgent: null,
    isArchived: false,
    lastMessageAt: "2026-01-01T09:00:00Z",
    lastMessagePreview: null,
    tags: [{ id: "t1", name: "VIP", color: null }],
  };

  it("turns priority and tag events into a conversation update carrying both", () => {
    for (const type of ["conversation.priority_changed", "conversation.tags_updated"]) {
      const [frame] = translator.fromBackend({ type, payload: { conversationId: "a", conversation } });
      expect(frame).toMatchObject({
        type: "conversation.updated",
        payload: {
          conversation: { id: "a", priority: "HIGH", urgent: true, tags: [{ id: "t1", name: "VIP", color: null }] },
        },
      });
    }
  });
});
