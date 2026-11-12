import { createRemoteJWKSet, exportJWK, exportSPKI, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { logger } from "@config/logger.js";
import { AppError, UnauthorizedError } from "@shared/errors/AppError.js";

import { losVerifierFrom, LosTokenVerifier, MemoryUsedTokenIds, parseStaffRoleMap } from "../auth.los.js";

const config = {
  issuer: "https://los.example.test",
  customerAudience: "luyleun",
  handoffAudience: "chat",
  handoffTokenType: "chat-handoff",
  staffAccessAudience: "los-client",
};

let privateKey: CryptoKey;
let publicKey: CryptoKey;
let verifier: LosTokenVerifier;

/** A signed LOS token; every token gets a fresh `jti` unless `jti` is given (`null` leaves it out). */
const sign = (
  claims: JWTPayload,
  options: { aud?: string; iss?: string; exp?: string | null; key?: CryptoKey; jti?: string | null } = {},
) => {
  const jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(options.iss ?? config.issuer)
    .setAudience(options.aud ?? config.customerAudience)
    .setIssuedAt();
  if (options.exp !== null) jwt.setExpirationTime(options.exp ?? "5m");
  if (options.jti !== null) jwt.setJti(options.jti ?? crypto.randomUUID());
  return jwt.sign(options.key ?? privateKey);
};

const customer = { userId: 2, username: "dara", type: "customer", tokenType: "access" };
const staff = { userId: 7, username: "sophea", type: "staff", tokenType: "chat-handoff", role: "agent" };

beforeAll(async () => {
  ({ privateKey, publicKey } = await generateKeyPair("RS256"));
  verifier = new LosTokenVerifier(config, publicKey);
});

describe("LosTokenVerifier", () => {
  it("reads a customer access token", async () => {
    await expect(verifier.verifyCustomer(await sign(customer))).resolves.toEqual({
      losUserType: "CUSTOMER",
      losUserId: 2,
      username: "dara",
      role: "CUSTOMER",
    });
  });

  it("reads a staff hand-off token and maps its role in any case", async () => {
    await expect(verifier.verifyStaffHandoff(await sign(staff, { aud: "chat" }))).resolves.toEqual({
      losUserType: "STAFF",
      losUserId: 7,
      username: "sophea",
      role: "AGENT",
    });
    const supervisor = await sign({ ...staff, role: "SUPERVISOR" }, { aud: "chat" });
    await expect(verifier.verifyStaffHandoff(supervisor)).resolves.toMatchObject({ role: "SUPERVISOR" });
  });

  describe("staff access token (LOS username and password sign-in)", () => {
    const access = { userId: 2, username: "admin", type: "staff", tokenType: "access", role: "ADMIN" };
    const map = new Map([["admin", "ADMIN" as const]]);
    const withMap = () => new LosTokenVerifier({ ...config, staffRoleMap: map }, publicKey);

    it("reads an LOS staff access token (no jti needed: it never leaves the server)", async () => {
      const token = await sign(access, { aud: "los-client", jti: null });
      await expect(withMap().verifyStaffAccess(token)).resolves.toEqual({
        losUserType: "STAFF",
        losUserId: 2,
        username: "admin",
        role: "ADMIN",
      });
    });

    it.each([
      ["an unmapped admin role", () => sign(access, { aud: "los-client" }), () => verifier],
      ["the wrong audience", () => sign(access, { aud: "chat" }), withMap],
      ["a customer token", () => sign({ ...access, type: "customer" }, { aud: "los-client" }), withMap],
      ["a refresh token", () => sign({ ...access, tokenType: "refresh" }, { aud: "los-client" }), withMap],
      ["a hand-off token", () => sign({ ...access, tokenType: "chat-handoff" }, { aud: "los-client" }), withMap],
      ["the wrong issuer", () => sign(access, { aud: "los-client", iss: "https://evil.test" }), withMap],
    ])("refuses %s", async (_, token, subject) => {
      await expect(subject().verifyStaffAccess(await token())).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it("is off when no staff access audience is configured", async () => {
      const { staffAccessAudience: _unused, ...without } = config;
      const off = new LosTokenVerifier({ ...without, staffRoleMap: map }, publicKey);
      await expect(off.verifyStaffAccess(await sign(access, { aud: "los-client" }))).rejects.toBeInstanceOf(
        UnauthorizedError,
      );
    });
  });

  it.each([
    ["the wrong audience", () => sign(customer, { aud: "chat" })],
    ["the wrong issuer", () => sign(customer, { iss: "https://evil.test" })],
    ["an expired token", () => sign(customer, { exp: "-1m" })],
    ["a staff token", () => sign({ ...customer, type: "staff" })],
    ["a refresh token", () => sign({ ...customer, tokenType: "refresh" })],
    ["a non-integer userId", () => sign({ ...customer, userId: "2" })],
    ["a userId out of INT range", () => sign({ ...customer, userId: 2 ** 31 })],
    ["a missing username", () => sign({ ...customer, username: " " })],
    ["no expiry", () => sign(customer, { exp: null })],
  ])("refuses a customer token with %s", async (_, token) => {
    await expect(verifier.verifyCustomer(await token())).rejects.toThrow(new UnauthorizedError("Invalid LOS token"));
  });

  it("refuses staff tokens that are not hand-off tokens or carry no known staff role", async () => {
    for (const claims of [
      { ...staff, tokenType: "access" },
      { ...staff, role: "CUSTOMER" },
      { ...staff, role: "loan_officer" },
      { ...staff, role: undefined },
      // ADMIN only through LOS_STAFF_ROLE_MAP (none is configured here).
      { ...staff, role: "admin" },
    ]) {
      await expect(verifier.verifyStaffHandoff(await sign(claims, { aud: "chat" }))).rejects.toBeInstanceOf(
        UnauthorizedError,
      );
    }
    // A customer token is not a hand-off token, even with the hand-off audience.
    await expect(verifier.verifyStaffHandoff(await sign(customer, { aud: "chat" }))).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it("signs in with a hand-off token once: the same jti again is refused", async () => {
    const token = await sign(staff, { aud: "chat" });
    await expect(verifier.verifyStaffHandoff(token)).resolves.toMatchObject({ losUserId: 7 });
    await expect(verifier.verifyStaffHandoff(token)).rejects.toThrow(new UnauthorizedError("Invalid LOS token"));
    // Another token with the same jti is a replay too.
    const jti = crypto.randomUUID();
    await expect(verifier.verifyStaffHandoff(await sign(staff, { aud: "chat", jti }))).resolves.toBeDefined();
    await expect(verifier.verifyStaffHandoff(await sign(staff, { aud: "chat", jti }))).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it("refuses a hand-off token that lives longer than LOS_HANDOFF_TOKEN_MAX_AGE", async () => {
    const strict = new LosTokenVerifier({ ...config, handoffMaxAgeSeconds: 120 }, publicKey);
    await expect(strict.verifyStaffHandoff(await sign(staff, { aud: "chat", exp: "2m" }))).resolves.toBeDefined();
    await expect(strict.verifyStaffHandoff(await sign(staff, { aud: "chat", exp: "10m" }))).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it("refuses a hand-off token without a jti", async () => {
    await expect(verifier.verifyStaffHandoff(await sign(staff, { aud: "chat", jti: null }))).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it("does not use up a jti on a token refused for another reason", async () => {
    const jti = crypto.randomUUID();
    await expect(
      verifier.verifyStaffHandoff(await sign({ ...staff, role: "teller" }, { aud: "chat", jti })),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(verifier.verifyStaffHandoff(await sign(staff, { aud: "chat", jti }))).resolves.toBeDefined();
  });

  it("answers 503 when the used-token store fails, rather than allowing a possible replay", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => logger);
    const broken = new LosTokenVerifier(config, publicKey, {
      claim: () => Promise.reject(new Error("redis down")),
    });
    const error = await broken.verifyStaffHandoff(await sign(staff, { aud: "chat" })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ status: 503, code: "LOS_SIGN_IN_UNAVAILABLE" });
    warn.mockRestore();
  });

  it("customer tokens are not single-use (the app keeps its LOS access token)", async () => {
    const token = await sign(customer);
    await verifier.verifyCustomer(token);
    await expect(verifier.verifyCustomer(token)).resolves.toMatchObject({ losUserId: 2 });
  });

  it("accepts a few seconds of clock difference with LOS, but not more than 30", async () => {
    await expect(verifier.verifyCustomer(await sign(customer, { exp: "-10s" }))).resolves.toMatchObject({
      losUserId: 2,
    });
    await expect(verifier.verifyCustomer(await sign(customer, { exp: "-31s" }))).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it("refuses a token signed with another key, or with HS256", async () => {
    const other = await generateKeyPair("RS256");
    await expect(verifier.verifyCustomer(await sign(customer, { key: other.privateKey }))).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    const hs = await new SignJWT(customer)
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(config.issuer)
      .setAudience(config.customerAudience)
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode("k".repeat(40)));
    await expect(verifier.verifyCustomer(hs)).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(verifier.verifyCustomer("not-a-jwt")).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe("LOS staff role names (LOS_STAFF_ROLE_MAP)", () => {
  it("maps LOS names to chat roles in any case, and still accepts the chat's own names", async () => {
    const mapped = new LosTokenVerifier(
      { ...config, staffRoleMap: parseStaffRoleMap("loan_officer:AGENT, Branch_Manager:supervisor") },
      publicKey,
    );
    const handoff = (role: string) => sign({ ...staff, role }, { aud: "chat" });
    await expect(mapped.verifyStaffHandoff(await handoff("LOAN_OFFICER"))).resolves.toMatchObject({ role: "AGENT" });
    await expect(mapped.verifyStaffHandoff(await handoff("branch_manager"))).resolves.toMatchObject({
      role: "SUPERVISOR",
    });
    // "admin" is not mapped here, so it is refused: ADMIN is never taken from the LOS role name alone.
    await expect(mapped.verifyStaffHandoff(await handoff("admin"))).rejects.toBeInstanceOf(UnauthorizedError);
    const withAdmin = new LosTokenVerifier(
      { ...config, staffRoleMap: parseStaffRoleMap("chat_admin:ADMIN") },
      publicKey,
    );
    await expect(withAdmin.verifyStaffHandoff(await handoff("Chat_Admin"))).resolves.toMatchObject({ role: "ADMIN" });
    await expect(mapped.verifyStaffHandoff(await handoff("teller"))).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("does not mistake built-in object properties for mapped roles", async () => {
    const mapped = new LosTokenVerifier(
      { ...config, staffRoleMap: parseStaffRoleMap("loan_officer:AGENT") },
      publicKey,
    );
    for (const role of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      await expect(mapped.verifyStaffHandoff(await sign({ ...staff, role }, { aud: "chat" }))).rejects.toBeInstanceOf(
        UnauthorizedError,
      );
    }
    expect(parseStaffRoleMap("__proto__:AGENT").get("__proto__")).toBe("AGENT");
  });

  it("refuses a malformed setting or a target that is not a staff role", () => {
    expect(parseStaffRoleMap("").size).toBe(0);
    expect(() => parseStaffRoleMap("loan_officer")).toThrow(/not "losName:ROLE"/);
    expect(() => parseStaffRoleMap("a:b:c")).toThrow(/not "losName:ROLE"/);
    expect(() => parseStaffRoleMap("vip:CUSTOMER")).toThrow(/not a staff role/);
    expect(() => parseStaffRoleMap("manager:BOSS")).toThrow(/not a staff role/);
  });
});

describe("LOS key problems", () => {
  it("answers 401 and logs a warning when the LOS key endpoint cannot be reached", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => logger);
    const offline = new LosTokenVerifier(config, createRemoteJWKSet(new URL("http://127.0.0.1:9/jwks")));
    await expect(offline.verifyCustomer(await sign(customer))).rejects.toThrow(
      new UnauthorizedError("Invalid LOS token"),
    );
    expect(warn).toHaveBeenCalledWith(expect.anything(), "could not load the LOS signing keys");
    warn.mockClear();
    // A token that is merely wrong is the caller's problem: no warning.
    await expect(verifier.verifyCustomer("not-a-jwt")).rejects.toBeInstanceOf(UnauthorizedError);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("MemoryUsedTokenIds", () => {
  it("forgets an id once its time has passed", async () => {
    let now = 1_000;
    const ids = new MemoryUsedTokenIds(() => now);
    expect(await ids.claim("a", 500)).toBe(true);
    expect(await ids.claim("a", 500)).toBe(false);
    now = 1_501;
    expect(await ids.claim("a", 500)).toBe(true);
  });
});

describe("losVerifierFrom", () => {
  const base = {
    LOS_CUSTOMER_AUDIENCE: "luyleun",
    LOS_HANDOFF_AUDIENCE: "chat",
    LOS_HANDOFF_TOKEN_TYPE: "chat-handoff",
  };

  it("is off without LOS_ISSUER", async () => {
    await expect(losVerifierFrom(base)).resolves.toBeNull();
  });

  it("reads a PEM public key, with \\n escapes as an env file has them", async () => {
    const pem = (await exportSPKI(publicKey)).replace(/\n/g, "\\n");
    const fromEnv = await losVerifierFrom({ ...base, LOS_ISSUER: config.issuer, LOS_PUBLIC_KEY: pem });
    await expect(fromEnv?.verifyCustomer(await sign(customer))).resolves.toMatchObject({ losUserId: 2 });
  });
});

describe("LOS JWKS key refresh", () => {
  let server: Server | undefined;
  afterEach(async () => {
    vi.useRealTimers();
    await new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined)));
    server = undefined;
  });

  /** A JWKS endpoint whose key set the test can swap, like an LOS key rotation. */
  async function jwksServer(initial: object[]) {
    let keys = initial;
    server = createServer((_, res) => {
      res.setHeader("content-type", "application/json").end(JSON.stringify({ keys }));
    });
    await new Promise((resolve) => server?.listen(0, "127.0.0.1", () => resolve(undefined)));
    return {
      url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/jwks.json`,
      replace: (next: object[]) => (keys = next),
    };
  }

  const publicJwk = async (key: CryptoKey, kid?: string) => ({
    ...(await exportJWK(key)),
    alg: "RS256",
    use: "sig",
    ...(kid && { kid }),
  });
  const signWith = (key: CryptoKey, kid?: string) =>
    new SignJWT(customer)
      .setProtectedHeader({ alg: "RS256", ...(kid && { kid }) })
      .setIssuer(config.issuer)
      .setAudience(config.customerAudience)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(key);
  const env = (url: string) => ({
    LOS_ISSUER: config.issuer,
    LOS_JWKS_URL: url,
    LOS_CUSTOMER_AUDIENCE: "luyleun",
    LOS_HANDOFF_AUDIENCE: "chat",
    LOS_HANDOFF_TOKEN_TYPE: "chat-handoff",
  });

  it("verifies a token without a kid against the one key in the JWKS", async () => {
    const jwks = await jwksServer([await publicJwk(publicKey, "a1b2c3d4e5f60718")]);
    const los = await losVerifierFrom(env(jwks.url));
    await expect(los?.verifyCustomer(await signWith(privateKey))).resolves.toMatchObject({ losUserId: 2 });
  });

  it("picks up a rotated key when a token with an unknown kid arrives", async () => {
    const rotated = await generateKeyPair("RS256");
    const jwks = await jwksServer([await publicJwk(publicKey, "old")]);
    const los = await losVerifierFrom(env(jwks.url));
    await expect(los?.verifyCustomer(await signWith(privateKey, "old"))).resolves.toBeDefined();

    jwks.replace([await publicJwk(rotated.publicKey, "new")]);
    // jose waits 30 s between key fetches; the new key is accepted once that has passed.
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 31_000 });
    await expect(los?.verifyCustomer(await signWith(rotated.privateKey, "new"))).resolves.toBeDefined();
    // The old key is gone with the rotation.
    await expect(los?.verifyCustomer(await signWith(privateKey, "old"))).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
