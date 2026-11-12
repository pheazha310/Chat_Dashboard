import { beforeEach, describe, expect, it } from "vitest";
import { MappedAuthClient } from "@shared/auth/mapped-auth-client.js";
import { can, DEFAULT_ROLE_PERMISSIONS } from "@shared/auth/permissions.js";
import type { Role } from "@shared/auth/auth.types.js";
import { ForbiddenError, UnauthorizedError } from "@shared/errors/AppError.js";
import { AccountCheckedAuthClient } from "../auth.account-check.js";
import { hashPassword } from "../auth.password.js";
import { AuthService } from "../auth.service.js";
import { AccessTokens } from "../auth.tokens.js";
import { DEFAULT_AUTH_OPTIONS } from "../auth.types.js";
import { UserService } from "../user.service.js";
import { FakeAuthRepository } from "./fake-auth-repository.js";

/**
 * Seam D: the stack every REST request and WebSocket `auth` frame goes through, built exactly as app-container does but
 * with no LOS object anywhere (LOS_ISSUER and LOS_BASE_URL unset, as when LOS is down for good). A chat session must
 * authenticate, carry its role's permissions, and be cut off by suspension, all from this backend's own data.
 */
const tokens = new AccessTokens("k".repeat(40), 900);
const client = { userAgent: "vitest", ipAddress: "127.0.0.1" };
const PASSWORD = "agent-password-1";

describe("a chat session without LOS", () => {
  let repo: FakeAuthRepository;
  let users: UserService;
  let auth: AuthService;
  let authClient: MappedAuthClient;
  let now: number;

  const staff = async (username: string, role: Role) => {
    const user = await repo.createUser({
      username,
      passwordHash: await hashPassword(PASSWORD),
      role,
      displayName: username,
    });
    const session = await auth.login("staff", { username, password: PASSWORD }, client);
    return { user, session };
  };

  beforeEach(() => {
    repo = new FakeAuthRepository();
    now = 0;
    users = new UserService(repo.asRepository(), { setStatus: async () => {}, sync: async () => {} });
    auth = new AuthService(repo.asRepository(), tokens, DEFAULT_AUTH_OPTIONS);
    const checked = new AccountCheckedAuthClient(tokens, users, 60_000, () => now);
    // The identity resolver of app-container, reduced to what these tests need: the role's default permissions.
    const identities = {
      resolve: async ({ userId, role }: { userId: string; role: Role }) => ({
        chatUserId: userId,
        permissions: new Set<string>(DEFAULT_ROLE_PERMISSIONS[role]),
      }),
    };
    authClient = new MappedAuthClient(checked, identities, () => now);
  });

  it("authenticates with its own access token and carries the role's permissions", async () => {
    const { user, session } = await staff("ann", "SUPERVISOR");
    const context = await authClient.verifyToken(session.accessToken);
    expect(context).toMatchObject({ userId: user.id, role: "SUPERVISOR" });
    expect(can(context, "users.read")).toBe(true);
    expect(can(context, "users.manage")).toBe(false);
  });

  it("gives an agent less than an admin", async () => {
    const agent = await authClient.verifyToken((await staff("ann", "AGENT")).session.accessToken);
    const admin = await authClient.verifyToken((await staff("root", "ADMIN")).session.accessToken);
    expect(can(agent, "users.manage")).toBe(false);
    expect(can(admin, "users.manage")).toBe(true);
  });

  it("refuses the same token once an admin suspends the account, and refuses its refresh token", async () => {
    const { user, session } = await staff("ann", "AGENT");
    const admin = { userId: (await staff("root", "ADMIN")).user.id, role: "ADMIN" as const };
    await authClient.verifyToken(session.accessToken);

    await users.update(admin, user.id, { status: "DISABLED" });
    now += 60_001; // the account check is cached for a minute
    await expect(authClient.verifyToken(session.accessToken)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(auth.refresh("staff", session.refreshToken, client)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("refuses a token for an account that no longer exists, and a tampered token", async () => {
    const { user, session } = await staff("ann", "AGENT");
    repo.users.delete(user.id);
    now += 60_001;
    await expect(authClient.verifyToken(session.accessToken)).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(authClient.verifyToken(`${session.accessToken}x`)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("refuses LOS sign-in outright when LOS is not configured, and chat sign-in is unaffected", async () => {
    await expect(auth.losSignIn("staff", "token", client)).rejects.toMatchObject({
      status: 503,
      code: "LOS_SIGN_IN_DISABLED",
    });
    await expect(staff("ann", "AGENT")).resolves.toBeDefined();
  });
});
