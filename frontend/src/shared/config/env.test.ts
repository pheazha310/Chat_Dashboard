import { describe, expect, it } from "vitest";
import { deriveApiUrl } from "./env";

describe("deriveApiUrl", () => {
  it.each([
    ["ws://localhost:4000/ws", "http://localhost:4000/admin/api/v1"],
    ["wss://chat.example.com/ws", "https://chat.example.com/admin/api/v1"],
    ["ws://localhost:4000/ws?x=1", "http://localhost:4000/admin/api/v1"],
  ])("%s -> %s", (ws, api) => {
    expect(deriveApiUrl(ws)).toBe(api);
  });

  it("is undefined when there is no usable WebSocket URL", () => {
    expect(deriveApiUrl(undefined)).toBeUndefined();
    expect(deriveApiUrl("not a url")).toBeUndefined();
  });
});
