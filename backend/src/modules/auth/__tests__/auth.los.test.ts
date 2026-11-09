import { createRemoteJWKSet, exportSPKI, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { logger } from "@config/logger.js";
import { UnauthorizedError } from "@shared/errors/AppError.js";
import { losVerifierFrom, LosTokenVerifier, parseStaffRoleMap } from "../auth.los.js";

const config = {
  issuer: "https://los.example.test",
  customerAudience: "luyleun",
  handoffAudience: "chat",
  handoffTokenType: "chat-handoff",
};

let privateKey: CryptoKey;
let publicKey: CryptoKey;
let verifier: LosTokenVerifier;

const sign = (claims: JWTPayload, options: { aud?: string; iss?: string; exp?: string; key?: CryptoKey } = {}) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(options.iss ?? config.issuer)
    .setAudience(options.aud ?? config.customerAudience)
    .setIssuedAt()
    .setExpirationTime(options.exp ?? "5m")
    .sign(options.key ?? privateKey);

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

  it.each([
    ["the wrong audience", () => sign(customer, { aud: "chat" })],
    ["the wrong issuer", () => sign(customer, { iss: "https://evil.test" })],
    ["an expired token", () => sign(customer, { exp: "-1m" })],
    ["a staff token", () => sign({ ...customer, type: "staff" })],
    ["a refresh token", () => sign({ ...customer, tokenType: "refresh" })],
    ["a non-integer userId", () => sign({ ...customer, userId: "2" })],
    ["a userId out of INT range", () => sign({ ...customer, userId: 2 ** 31 })],
    ["a missing username", () => sign({ ...customer, username: " " })],
  ])("refuses a customer token with %s", async (_, token) => {
    await expect(verifier.verifyCustomer(await token())).rejects.toThrow(new UnauthorizedError("Invalid LOS token"));
  });

  it("refuses staff tokens that are not hand-off tokens or carry no known staff role", async () => {
    for (const claims of [
      { ...staff, tokenType: "access" },
      { ...staff, role: "CUSTOMER" },
      { ...staff, role: "loan_officer" },
      { ...staff, role: undefined },
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
    await expect(mapped.verifyStaffHandoff(await handoff("admin"))).resolves.toMatchObject({ role: "ADMIN" });
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
