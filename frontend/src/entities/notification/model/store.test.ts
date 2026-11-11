import { beforeEach, describe, expect, it } from "vitest";
import type { NotificationDto } from "@/shared/api/ws";
import { useNotificationStore } from "./store";

const make = (id: string, read = false): NotificationDto => ({
  id,
  agentId: "3",
  type: "system",
  text: `text ${id}`,
  read,
  createdAt: "2026-01-01T09:00:00.000Z",
});

const state = () => useNotificationStore.getState();

beforeEach(() => useNotificationStore.setState({ items: [], unreadCount: 0 }));

describe("setAll", () => {
  it("holds the loaded page and the server's unread total, which can exceed the page", () => {
    state().setAll([make("1"), make("2", true)], 12);
    expect(state().items.map((item) => item.id)).toEqual(["1", "2"]);
    expect(state().unreadCount).toBe(12);
  });
});

describe("add", () => {
  it("puts a live notification first and counts it as unread", () => {
    state().setAll([make("1")], 1);
    state().add(make("2"));
    expect(state().items.map((item) => item.id)).toEqual(["2", "1"]);
    expect(state().unreadCount).toBe(2);
  });

  it("ignores a notification it already holds, such as one replayed after a reconnect", () => {
    state().setAll([make("1")], 1);
    state().add(make("1"));
    expect(state().items).toHaveLength(1);
    expect(state().unreadCount).toBe(1);
  });
});

describe("markRead", () => {
  it("marks one unread notification read and lowers the count", () => {
    state().setAll([make("1"), make("2")], 2);
    state().markRead("1");
    expect(state().items.find((item) => item.id === "1")?.read).toBe(true);
    expect(state().unreadCount).toBe(1);
  });

  it("does not lower the count twice for a notification that is already read", () => {
    state().setAll([make("1", true)], 3);
    state().markRead("1");
    expect(state().unreadCount).toBe(3);
  });
});

describe("markAllRead", () => {
  it("marks everything read and zeroes the count", () => {
    state().setAll([make("1"), make("2")], 5);
    state().markAllRead();
    expect(state().items.every((item) => item.read)).toBe(true);
    expect(state().unreadCount).toBe(0);
  });
});

describe("applyRead (another session of this agent read something)", () => {
  it("marks the named notification read and takes the server's count", () => {
    state().setAll([make("1"), make("2")], 2);
    state().applyRead("1", 1);
    expect(state().items.find((item) => item.id === "1")?.read).toBe(true);
    expect(state().unreadCount).toBe(1);
  });

  it("marks everything read when no id is named", () => {
    state().setAll([make("1"), make("2")], 2);
    state().applyRead(null, 0);
    expect(state().items.every((item) => item.read)).toBe(true);
    expect(state().unreadCount).toBe(0);
  });
});
