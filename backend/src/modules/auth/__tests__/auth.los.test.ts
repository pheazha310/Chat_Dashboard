import { exportSPKI, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { UnauthorizedError } from "@shared/errors/AppError.js";
import { losVerifierFrom, LosTokenVerifier } from "../auth.los.js";

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
