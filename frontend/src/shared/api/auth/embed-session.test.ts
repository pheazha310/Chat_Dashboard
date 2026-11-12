import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const entries = vi.hoisted(() => {
  const map = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => map.set(key, value),
      removeItem: (key: string) => map.delete(key),
    },
  });
  return map;
});
vi.mock("@/shared/config", () => ({
  API_URL: "http://localhost:4000/api/v1/admin",
  AUTH_SESSION_KEY: "auth.session",
  DEV_AUTH_TOKEN: undefined,
}));

import { listenForHandoff } from "./embed";
import { readSession, refreshSession, signInWithHandoff, useAuthStore, type AuthSession } from "./session";

/**
 * Seam: the iframe's sign-in life as App.tsx drives it. Hand-off token in, session kept; an iframe reload reuses the
 * session without a new token; when the session ends, the next listener asks LOS Web for a fresh token.
 */
const LOS = "https://los-dev.delightech.asia";
const user = { id: "u1", username: null, email: null, displayName: "Sophea", role: "AGENT", status: "ACTIVE" };
const session = (n: number): AuthSession => ({
  accessToken: `access-${n}`,
  accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
  refreshToken: `refresh-${n}`,
  refreshTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  user,
});
const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ status: "success", data }) });
const refused = () => ({
  ok: false,
  status: 401,
  json: async () => ({ status: "error", error: { code: "UNAUTHORIZED", message: "Invalid or expired refresh token" } }),
});

/** What App.tsx does while signed out in an iframe; `deliver` plays LOS Web answering with a token. */
function openIframe(exchange: (token: string) => Promise<unknown>) {
  const parent = { postMessage: vi.fn() };
  let handler: ((event: MessageEvent) => void) | undefined;
  const target = {
    addEventListener: (_: "message", fn: typeof handler) => (handler = fn),
    removeEventListener: vi.fn(),
  };
  const stop = listenForHandoff({ parentOrigin: LOS, parent, target: target as never, exchange });
  const deliver = (token: string) =>
    handler?.({ origin: LOS, source: parent, data: { type: "HANDOFF_TOKEN", token } } as unknown as MessageEvent);
  return { parent, deliver, stop };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  entries.clear();
  useAuthStore.setState({ user: null });
});
afterEach(() => vi.unstubAllGlobals());

describe("iframe sign-in", () => {
  it("signs in with the hand-off token, sends it only in the body, and does not keep it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(session(1)));
    vi.stubGlobal("fetch", fetchMock);
    const { deliver } = openIframe(signInWithHandoff);
    deliver("a.b.c");
    await settle();

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://localhost:4000/api/v1/admin/auth/los");
    expect(url).not.toContain("a.b.c");
    expect(JSON.parse(init.body)).toEqual({ handoffToken: "a.b.c" });
    expect(useAuthStore.getState().user).toEqual(user);
    expect(JSON.stringify([...entries.values()])).not.toContain("a.b.c");
  });

  it("stays signed out when the backend refuses the token (expired or already used)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ...refused(),
        json: async () => ({ status: "error", error: { code: "UNAUTHORIZED", message: "Invalid LOS token" } }),
      }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { deliver } = openIframe(signInWithHandoff);
    deliver("expired.or.used");
    await settle();
    expect(useAuthStore.getState().user).toBeNull();
    expect(readSession()).toBeNull();
  });
});

describe("iframe reload and session expiry", () => {
  it("a reloaded iframe still has its session and refreshes it without a new hand-off token", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(ok(session(1)))
        .mockResolvedValueOnce(ok(session(2))),
    );
    await signInWithHandoff("a.b.c");

    // The reload: nothing in memory, only what was stored.
    expect(readSession()?.refreshToken).toBe("refresh-1");
    await expect(refreshSession()).resolves.toBe(true);
    expect(readSession()?.accessToken).toBe("access-2");
  });

  it("when the session ends, the user is signed out and a new listener asks LOS Web for a fresh token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok(session(1)))
      .mockResolvedValueOnce(refused())
      .mockResolvedValueOnce(ok(session(3)));
    vi.stubGlobal("fetch", fetchMock);
    await signInWithHandoff("first.hand.off");

    await expect(refreshSession()).resolves.toBe(false);
    expect(useAuthStore.getState().user).toBeNull();
    expect(readSession()).toBeNull();

    const { parent, deliver } = openIframe(signInWithHandoff);
    expect(parent.postMessage).toHaveBeenCalledWith({ type: "TOKEN_REQUEST" }, LOS);
    deliver("second.hand.off");
    await settle();
    expect(useAuthStore.getState().user).toEqual(user);
    expect(readSession()?.accessToken).toBe("access-3");
    expect(JSON.parse(fetchMock.mock.calls[2]![1].body)).toEqual({ handoffToken: "second.hand.off" });
  });
});
