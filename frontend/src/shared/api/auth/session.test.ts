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

import {
  AuthError,
  authRequired,
  ensureFreshToken,
  readSession,
  refreshSession,
  signIn,
  signOut,
  useAuthStore,
  type AuthSession,
} from "./session";

const user = {
  id: "u1",
  username: "ann",
  email: "ann@example.com",
  displayName: "Ann",
  role: "AGENT",
  status: "ACTIVE",
};
const session = (n: number, expiresInMs = 900_000): AuthSession => ({
  accessToken: `access-${n}`,
  accessTokenExpiresAt: new Date(Date.now() + expiresInMs).toISOString(),
  refreshToken: `refresh-${n}`,
  refreshTokenExpiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  user,
});
const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ status: "success", data }) });
const fail = (status: number, code: string, message: string) => ({
  ok: false,
  status,
  json: async () => ({ status: "error", error: { code, message } }),
});
const store = (value: AuthSession) => entries.set("auth.session", JSON.stringify(value));

beforeEach(() => {
  entries.clear();
  useAuthStore.setState({ user: null });
});
afterEach(() => vi.unstubAllGlobals());

describe("auth session", () => {
  it("needs sign-in against the backend when no dev token is set", () => {
    expect(authRequired).toBe(true);
  });

  it("signs in: posts the credentials and keeps the session", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(session(1)));
    vi.stubGlobal("fetch", fetchMock);
    await expect(signIn("ann", "pw")).resolves.toEqual(user);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://localhost:4000/api/v1/admin/auth/login");
    expect(JSON.parse(init.body)).toEqual({ username: "ann", password: "pw" });
    expect(readSession()?.accessToken).toBe("access-1");
    expect(useAuthStore.getState().user).toEqual(user);
  });

  it("reports the server's message when sign-in is refused, and keeps nothing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fail(401, "UNAUTHORIZED", "Invalid username or password")));
    await expect(signIn("ann@example.com", "bad")).rejects.toMatchObject({
      name: "AuthError",
      status: 401,
      message: "Invalid username or password",
    });
    expect(readSession()).toBeNull();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(signIn("ann", "pw")).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  });

  it("refreshes once for concurrent callers and stores the rotated pair", async () => {
    store(session(1));
    const fetchMock = vi.fn().mockResolvedValue(ok(session(2)));
    vi.stubGlobal("fetch", fetchMock);

    const results = await Promise.all([refreshSession(), refreshSession(), refreshSession()]);
    expect(results).toEqual([true, true, true]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ refreshToken: "refresh-1" });
    expect(readSession()?.refreshToken).toBe("refresh-2");
  });

  it("signs out when the server refuses the refresh token", async () => {
    store(session(1));
    useAuthStore.setState({ user });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fail(401, "UNAUTHORIZED", "Invalid or expired refresh token")));
    await expect(refreshSession()).resolves.toBe(false);
    expect(readSession()).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it("keeps the session when the backend cannot be reached", async () => {
    store(session(1));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(refreshSession()).rejects.toBeInstanceOf(AuthError);
    expect(readSession()?.refreshToken).toBe("refresh-1");
  });

  it("refreshes ahead only when the access token is about to expire", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(session(2)));
    vi.stubGlobal("fetch", fetchMock);
    store(session(1, 600_000));
    await ensureFreshToken();
    expect(fetchMock).not.toHaveBeenCalled();
    store(session(1, 10_000));
    await ensureFreshToken();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readSession()?.accessToken).toBe("access-2");
  });

  it("signs out locally even if the server cannot be told", async () => {
    store(session(1));
    useAuthStore.setState({ user });
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("offline"));
    vi.stubGlobal("fetch", fetchMock);
    await signOut();
    expect(readSession()).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ refreshToken: "refresh-1" });
  });
});
