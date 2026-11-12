import { generateKeyPair, SignJWT } from "jose";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { can } from "@shared/auth/permissions.js";
import { UnauthorizedError } from "@shared/errors/AppError.js";
import { LosTokenVerifier, parseStaffRoleMap } from "../auth.los.js";
import { AuthService } from "../auth.service.js";
import { AccessTokens } from "../auth.tokens.js";
import { DEFAULT_AUTH_OPTIONS } from "../auth.types.js";
import { FakeAuthRepository } from "./fake-auth-repository.js";

/**
 * Seam: a real signed LOS hand-off token goes through the real verifier and AuthService (only the database is faked),
 * and the access token that comes out decides what the staff member may do. Nothing about the role is read from the
 * caller: it comes from the token LOS signed and the server's LOS_STAFF_ROLE_MAP.
 */
const config = {
  issuer: "https://los.example.test",
  customerAudience: "luyleun",
  handoffAudience: "chat",
  handoffTokenType: "chat-handoff",
  handoffMaxAgeSeconds: 120,
  staffRoleMap: parseStaffRoleMap("credit_support_officer:AGENT,operation_supervisor:SUPERVISOR,super_admin:ADMIN"),
};
const client = { userAgent: "vitest", ipAddress: "127.0.0.1" };
const tokens = new AccessTokens("k".repeat(40), 900);

let privateKey: CryptoKey;
let service: AuthService;
let repo: FakeAuthRepository;

const handoff = (claims: Record<string, unknown>, options: { exp?: string } = {}) =>
  new SignJWT({ type: "staff", tokenType: "chat-handoff", ...claims })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(config.issuer)
    .setAudience("chat")
    .setIssuedAt()
    .setExpirationTime(options.exp ?? "90s")
    .setJti(crypto.randomUUID())
    .sign(privateKey);

let verifierKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  verifierKey = pair.publicKey;
});

beforeEach(() => {
  repo = new FakeAuthRepository();
  service = new AuthService(
    repo.asRepository(),
    tokens,
    DEFAULT_AUTH_OPTIONS,
    () => new Date(),
    { sync: async () => {} },
    new LosTokenVerifier(config, verifierKey),
  );
});

const signInAs = async (role: string, userId = 7) => {
  const session = await service.losSignIn("staff", await handoff({ userId, username: `u${userId}`, role }), client);
  const auth = await tokens.verifyToken(session.accessToken);
  return { session, auth };
};

describe("hand-off sign-in, role by role", () => {
  it("signs an agent in with the agent's permissions", async () => {
    const { auth } = await signInAs("credit_support_officer");
    expect(auth.role).toBe("AGENT");
    expect(can(auth, "conversations.view_all")).toBe(false);
    expect(can(auth, "users.manage")).toBe(false);
  });

  it("signs a supervisor in: sees every conversation, cannot manage accounts or roles", async () => {
    const { auth } = await signInAs("operation_supervisor");
    expect(auth.role).toBe("SUPERVISOR");
    expect(can(auth, "conversations.view_all")).toBe(true);
    expect(can(auth, "users.manage")).toBe(false);
    expect(can(auth, "roles.manage")).toBe(false);
  });

  it("signs an admin in only through the server's role map: manages accounts and roles", async () => {
    const { auth } = await signInAs("super_admin");
    expect(auth.role).toBe("ADMIN");
    expect(can(auth, "users.manage")).toBe(true);
    expect(can(auth, "roles.manage")).toBe(true);
  });

  it("refuses an LOS role that is not approved, including one that merely says admin", async () => {
    for (const role of ["admin", "customer", "janitor", ""]) {
      await expect(
        service.losSignIn("staff", await handoff({ userId: 9, username: "x", role }), client),
      ).rejects.toThrow(UnauthorizedError);
    }
    expect(repo.users.size).toBe(0);
  });
});

describe("hand-off sign-in, identity mapping", () => {
  it("creates the chat account on a staff member's first sign-in", async () => {
    expect(repo.users.size).toBe(0);
    const { session } = await signInAs("credit_support_officer", 41);
    expect(repo.users.size).toBe(1);
    expect(session.user).toMatchObject({ role: "AGENT", displayName: "u41" });
  });

  it("reaches the same chat account on every later sign-in and follows a role change", async () => {
    const first = await signInAs("credit_support_officer", 41);
    const second = await signInAs("operation_supervisor", 41);
    expect(second.session.user.id).toBe(first.session.user.id);
    expect(repo.users.size).toBe(1);
    expect(second.auth.role).toBe("SUPERVISOR");
  });

  it("gives two LOS staff members two chat accounts", async () => {
    const a = await signInAs("credit_support_officer", 41);
    const b = await signInAs("credit_support_officer", 42);
    expect(a.session.user.id).not.toBe(b.session.user.id);
  });
});

describe("hand-off token lifetime and reuse", () => {
  it("refuses the same hand-off token twice, and creates no second session", async () => {
    const token = await handoff({ userId: 7, username: "sophea", role: "credit_support_officer" });
    await service.losSignIn("staff", token, client);
    const sessions = repo.sessions.length;
    await expect(service.losSignIn("staff", token, client)).rejects.toThrow(UnauthorizedError);
    expect(repo.sessions.length).toBe(sessions);
  });

  it("refuses an expired hand-off token", async () => {
    const token = await handoff({ userId: 7, username: "s", role: "credit_support_officer" }, { exp: "-5m" });
    await expect(service.losSignIn("staff", token, client)).rejects.toThrow(UnauthorizedError);
  });

  it("refuses the analytics-dashboard token: wrong audience and token type", async () => {
    const analytics = await new SignJWT({
      type: "staff",
      tokenType: "analytics-handoff",
      userId: 7,
      username: "s",
      role: "super_admin",
    })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(config.issuer)
      .setAudience("analytics")
      .setIssuedAt()
      .setExpirationTime("90s")
      .setJti(crypto.randomUUID())
      .sign(privateKey);
    await expect(service.losSignIn("staff", analytics, client)).rejects.toThrow(UnauthorizedError);
  });
});
