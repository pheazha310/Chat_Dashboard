import { SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UnauthorizedError } from "@shared/errors/AppError.js";
import { DevAuthClient } from "@shared/auth/dev-auth-client.js";
import { uid } from "../../../__tests__/support/ids.js";
import { AccessTokens, DevOrJwtAuthClient, hashRefreshToken, newRefreshToken } from "../auth.tokens.js";

const SECRET = "s".repeat(40);
const tokens = new AccessTokens(SECRET, 900);

describe("AccessTokens", () => {
  afterEach(() => vi.useRealTimers());

  it("issues a token that verifies to the same user and role", async () => {
    const { token, expiresAt } = await tokens.issue({ id: uid(1), role: "AGENT" });
    await expect(tokens.verifyToken(token)).resolves.toEqual({ userId: uid(1), role: "AGENT" });
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(890_000);
  });

  it("refuses a token signed with another key", async () => {
    const { token } = await new AccessTokens("o".repeat(40), 900).issue({ id: uid(1), role: "ADMIN" });
    await expect(tokens.verifyToken(token)).rejects.toThrow(new UnauthorizedError("Invalid token"));
  });

  it("refuses a tampered token", async () => {
    const { token } = await tokens.issue({ id: uid(1), role: "AGENT" });
    const [header, , signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: uid(1), role: "ADMIN", typ: "access" })).toString("base64url");
    await expect(tokens.verifyToken(`${header}.${forged}.${signature}`)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("refuses an expired token with its own message", async () => {
    vi.useFakeTimers({ now: new Date("2026-01-01T00:00:00Z") });
    const { token } = await tokens.issue({ id: uid(1), role: "AGENT" });
    vi.setSystemTime(new Date("2026-01-01T00:16:00Z"));
    await expect(tokens.verifyToken(token)).rejects.toThrow("Access token expired");
  });

  it("refuses tokens with an unknown role, a non-uuid subject or another type", async () => {
    const key = new TextEncoder().encode(SECRET);
    const sign = (claims: Record<string, unknown>, sub: string) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(sub)
        .setIssuer("chat-dashboard")
        .setAudience("chat-dashboard")
        .setExpirationTime("5m")
        .sign(key);
    await expect(tokens.verifyToken(await sign({ role: "ROOT", typ: "access" }, uid(1)))).rejects.toThrow();
    await expect(tokens.verifyToken(await sign({ role: "AGENT", typ: "access" }, "42"))).rejects.toThrow();
    await expect(tokens.verifyToken(await sign({ role: "AGENT", typ: "refresh" }, uid(1)))).rejects.toThrow();
  });

  it("refuses an unsigned (alg none) token", async () => {
    const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const none = `${part({ alg: "none" })}.${part({ sub: uid(1), role: "ADMIN", typ: "access" })}.`;
    await expect(tokens.verifyToken(none)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("requires a long secret", () => {
    expect(() => new AccessTokens("short", 900)).toThrow();
  });
});

describe("refresh tokens", () => {
  it("are random and stored only as a SHA-256 hex digest", () => {
    const a = newRefreshToken();
    expect(a).not.toBe(newRefreshToken());
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(hashRefreshToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRefreshToken(a)).toBe(hashRefreshToken(a));
  });
});

describe("DevOrJwtAuthClient", () => {
  it("routes dev: tokens to the dev client and everything else to the JWT client", async () => {
    const client = new DevOrJwtAuthClient(new DevAuthClient(), tokens);
    await expect(client.verifyToken(`dev:${uid(2)}:SUPERVISOR`)).resolves.toEqual({
      userId: uid(2),
      role: "SUPERVISOR",
    });
    const { token } = await tokens.issue({ id: uid(3), role: "CUSTOMER" });
    await expect(client.verifyToken(token)).resolves.toEqual({ userId: uid(3), role: "CUSTOMER" });
    await expect(client.verifyToken("nonsense")).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
