import { describe, expect, it, vi } from "vitest";
import { AppError } from "@shared/errors/AppError.js";
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
});
