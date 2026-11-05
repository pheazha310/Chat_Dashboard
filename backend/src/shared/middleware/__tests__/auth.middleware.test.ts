import type { Request, Response } from "express";
import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it, vi } from "vitest";
import { ForbiddenError, UnauthorizedError } from "@shared/errors/AppError.js";
import { DevAuthClient } from "@shared/auth/dev-auth-client.js";
import { authenticate, bearerToken, requireRole } from "../auth.middleware.js";

const run = (handler: ReturnType<typeof authenticate>, authorization?: string) => {
  const req = fromPartial<Request>({ headers: { authorization } });
  const next = vi.fn();
  return { req, next, done: Promise.resolve(handler(req, fromPartial<Response>({}), next)) };
};

describe("auth middleware", () => {
  const mw = authenticate(new DevAuthClient());

  it("parses bearer headers strictly", () => {
    expect(bearerToken("Bearer abc")).toBe("abc");
    expect(bearerToken("Basic abc")).toBeUndefined();
    expect(bearerToken(undefined)).toBeUndefined();
  });

  it("attaches auth for a dashboard role", async () => {
    const { req, next, done } = run(mw, "Bearer dev:7:SUPERVISOR");
    await done;
    expect(req.auth).toEqual({ userId: 7n, role: "SUPERVISOR" });
    expect(next).toHaveBeenCalledOnce();
  });

  it("rejects a missing token", async () => {
    await expect(run(mw).done).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("rejects customers on the dashboard", async () => {
    await expect(run(mw, "Bearer dev:7:CUSTOMER").done).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("requireRole blocks insufficient roles", () => {
    const guard = requireRole("SUPERVISOR");
    const req = fromPartial<Request>({ auth: { userId: 1n, role: "AGENT" } });
    expect(() => guard(req, fromPartial<Response>({}), vi.fn())).toThrow(ForbiddenError);
  });
});
