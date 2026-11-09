import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({
  apiUrl: "http://localhost:4000/api/v1/admin" as string | undefined,
  token: "dev:3:AGENT" as string | undefined,
}));
vi.mock("@/shared/config", () => ({
  get API_URL() {
    return config.apiUrl;
  },
  getAuthToken: () => config.token,
}));

const auth = vi.hoisted(() => ({
  required: false,
  session: null as object | null,
  refresh: vi.fn<() => Promise<boolean>>(),
}));
vi.mock("@/shared/api/auth", () => ({
  get authRequired() {
    return auth.required;
  },
  ensureFreshToken: async () => {},
  readSession: () => auth.session,
  refreshSession: auth.refresh,
}));

import { ApiError, apiRequest } from "./client";
import { getMessages } from "./conversations";

const reply = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });

beforeEach(() => {
  config.apiUrl = "http://localhost:4000/api/v1/admin";
  config.token = "dev:3:AGENT";
  auth.required = false;
  auth.session = null;
  auth.refresh.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("apiRequest", () => {
  it("sends the bearer token and query, and unwraps data and meta", async () => {
    const fetchMock = reply(200, { status: "success", data: [1], meta: { hasMore: false } });
    vi.stubGlobal("fetch", fetchMock);
    const result = await apiRequest("/conversations", { query: { filter: "mine", page: 2, q: undefined } });
    expect(result).toEqual({ data: [1], meta: { hasMore: false } });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("http://localhost:4000/api/v1/admin/conversations?filter=mine&page=2");
    expect(init.headers).toMatchObject({ authorization: "Bearer dev:3:AGENT" });
    expect(init.method).toBe("GET");
  });

  it("sends JSON bodies", async () => {
    const fetchMock = reply(200, { status: "success", data: {} });
    vi.stubGlobal("fetch", fetchMock);
    await apiRequest("/x", { method: "POST", body: { a: 1 } });
    const init = fetchMock.mock.calls[0]![1];
    expect(init.body).toBe('{"a":1}');
    expect(init.headers).toMatchObject({ "content-type": "application/json" });
  });

  it("turns the backend's error envelope into an ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      reply(403, { status: "error", error: { code: "FORBIDDEN", message: "Only the owner can do that" } }),
    );
    await expect(apiRequest("/x")).rejects.toMatchObject({
      name: "ApiError",
      status: 403,
      code: "FORBIDDEN",
      message: "Only the owner can do that",
    });
  });

  it("handles non-JSON failures, network errors and a missing configuration", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => Promise.reject(new Error("html")) }),
    );
    await expect(apiRequest("/x")).rejects.toMatchObject({ status: 502, code: "UNKNOWN_ERROR" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(apiRequest("/x")).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    config.apiUrl = undefined;
    await expect(apiRequest("/x")).rejects.toBeInstanceOf(ApiError);
  });

  it("omits the authorization header when there is no token", async () => {
    config.token = undefined;
    const fetchMock = reply(200, { status: "success", data: null });
    vi.stubGlobal("fetch", fetchMock);
    await apiRequest("/x");
    expect(fetchMock.mock.calls[0]![1].headers).not.toHaveProperty("authorization");
  });
});

describe("apiRequest with a signed-in session", () => {
  const unauthorized = {
    ok: false,
    status: 401,
    json: async () => ({ status: "error", error: { code: "UNAUTHORIZED" } }),
  };

  it("refreshes after a 401 and retries once with the new token", async () => {
    auth.required = true;
    auth.session = {};
    auth.refresh.mockImplementation(async () => {
      config.token = "fresh";
      return true;
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(unauthorized)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: "success", data: 7 }) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiRequest("/x")).resolves.toMatchObject({ data: 7 });
    expect(auth.refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[1]![1].headers).toMatchObject({ authorization: "Bearer fresh" });
  });

  it("gives up with the 401 when the refresh is refused, and never refreshes without a session", async () => {
    auth.required = true;
    auth.session = {};
    auth.refresh.mockResolvedValue(false);
    const fetchMock = vi.fn().mockResolvedValue(unauthorized);
    vi.stubGlobal("fetch", fetchMock);
    await expect(apiRequest("/x")).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    auth.session = null;
    await expect(apiRequest("/x")).rejects.toMatchObject({ status: 401 });
    expect(auth.refresh).toHaveBeenCalledTimes(1);
  });
});

describe("getMessages", () => {
  it("passes the cursor and returns items with paging meta", async () => {
    const fetchMock = reply(200, {
      status: "success",
      data: [{ id: "1" }],
      meta: { hasMore: true, oldestSequence: "4" },
    });
    vi.stubGlobal("fetch", fetchMock);
    const page = await getMessages("12", { before: "9", limit: 50 });
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      "http://localhost:4000/api/v1/admin/conversations/12/messages?before=9&limit=50",
    );
    expect(page.items).toEqual([{ id: "1" }]);
    expect(page.meta).toMatchObject({ hasMore: true, oldestSequence: "4" });
  });
});
