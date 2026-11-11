import { afterEach, describe, expect, it, vi } from "vitest";
import { deriveApiUrl, getAuthToken } from "./env";

describe("deriveApiUrl", () => {
  it.each([
    ["ws://localhost:4000/ws", "http://localhost:4000/api/v1/admin"],
    ["wss://chat.example.com/ws", "https://chat.example.com/api/v1/admin"],
    ["ws://localhost:4000/ws?x=1", "http://localhost:4000/api/v1/admin"],
  ])("%s -> %s", (ws, api) => {
    expect(deriveApiUrl(ws)).toBe(api);
  });

  it("is undefined when there is no usable WebSocket URL", () => {
    expect(deriveApiUrl(undefined)).toBeUndefined();
    expect(deriveApiUrl("not a url")).toBeUndefined();
  });
});

describe("getAuthToken", () => {
  const stub = (entries: Record<string, string>) =>
    vi.stubGlobal("localStorage", { getItem: (key: string) => entries[key] ?? null });
  afterEach(() => vi.unstubAllGlobals());

  // A fixed VITE_AUTH_TOKEN (set for the live E2E run) always wins, so this only holds without one.
  it.skipIf(Boolean(import.meta.env.VITE_AUTH_TOKEN))("reads the signed-in session first, then the legacy key", () => {
    stub({ "auth.session": JSON.stringify({ accessToken: "jwt" }), "auth.token": "legacy" });
    expect(getAuthToken()).toBe("jwt");
    stub({ "auth.token": "legacy" });
    expect(getAuthToken()).toBe("legacy");
    stub({ "auth.session": "not json" });
    expect(getAuthToken()).toBeUndefined();
  });
});
