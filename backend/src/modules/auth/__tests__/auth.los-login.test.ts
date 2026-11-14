import { describe, expect, it, vi } from "vitest";
import { AppError } from "@shared/errors/AppError.js";
import { logger } from "@config/logger.js";
import { LosStaffLogin } from "../auth.los-login.js";

const jwt = (tag: string) => `h.${tag}.s`;
const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

describe("LosStaffLogin", () => {
  const BASE = "https://los.example/api/v1";

  it("logs in to LOS and returns the LOS access token", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementation(() =>
        json(200, { status: "success", data: { accessToken: jwt("access"), refreshToken: jwt("refresh"), user: {} } }),
      );

    await expect(new LosStaffLogin(BASE, fetchFn).accessToken("admin", "pw")).resolves.toBe(jwt("access"));

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe(`${BASE}/admin/auth/login`);
    expect(JSON.parse(String(init?.body))).toEqual({ username: "admin", password: "pw" });
  });

  it("answers null when LOS refuses the credentials", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(() => json(401, { status: "error" }));
    await expect(new LosStaffLogin(BASE, fetchFn).accessToken("admin", "bad")).resolves.toBeNull();
  });

  it("warns when LOS refuses the request itself (426, 400), which is not a wrong password", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(() => json(426, { status: "error" }));
    await expect(new LosStaffLogin(BASE, fetchFn).accessToken("admin", "pw")).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ status: 426 }), expect.any(String));
    warn.mockRestore();
  });

  it("says so when LOS is limiting logins, instead of looking like a wrong password", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(() => json(429, { status: "error" }));
    const error = await new LosStaffLogin(BASE, fetchFn).accessToken("admin", "pw").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ status: 429, code: "LOS_RATE_LIMITED" });
  });

  it("answers null when LOS is unreachable or answers something unexpected", async () => {
    const down = vi.fn<typeof fetch>().mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(new LosStaffLogin(BASE, down).accessToken("a", "b")).resolves.toBeNull();
    const odd = vi.fn<typeof fetch>().mockImplementation(() => json(200, { data: { nothing: true } }));
    await expect(new LosStaffLogin(BASE, odd).accessToken("a", "b")).resolves.toBeNull();
  });

  describe("when LOS is down", () => {
    it("stops asking LOS for a while after it was unreachable, so chat sign-in is not delayed", async () => {
      let now = 1_000_000;
      const down = vi.fn<typeof fetch>().mockRejectedValue(new Error("ECONNREFUSED"));
      const login = new LosStaffLogin(BASE, down, () => now);

      await expect(login.accessToken("a", "b")).resolves.toBeNull();
      await expect(login.accessToken("a", "b")).resolves.toBeNull();
      expect(down).toHaveBeenCalledTimes(1);

      now += 31_000; // the pause is over: LOS is tried again
      await expect(login.accessToken("a", "b")).resolves.toBeNull();
      expect(down).toHaveBeenCalledTimes(2);
    });

    it("does not pause for a refusal: a chat-only account is refused by a healthy LOS", async () => {
      const refuses = vi.fn<typeof fetch>().mockImplementation(() => json(401, { status: "error" }));
      const login = new LosStaffLogin(BASE, refuses, () => 1);
      await login.accessToken("a", "b");
      await login.accessToken("a", "b");
      expect(refuses).toHaveBeenCalledTimes(2);
    });
  });
});
