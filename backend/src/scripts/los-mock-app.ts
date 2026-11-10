/**
 * A stand-in for LOS (Backend 1) until the real one is connected: its own staff and customers with passwords, LOS-style
 * RS256 tokens, and a JWKS endpoint the chat backend reads its key from (LOS_JWKS_URL). The chat backend cannot tell
 * it from LOS, so the whole "sign in with LOS" flow runs for real; switching to LOS later is only `.env`.
 *
 * Development and staging only: `pnpm los:mock` refuses NODE_ENV=production. The users and their passwords are test
 * data, not secrets.
 */
import { timingSafeEqual } from "node:crypto";
import express, { type Request, type Response } from "express";
import { exportJWK, importSPKI } from "jose";
import { z } from "zod";
import { devCustomerToken, devHandoffToken, type DevLosKeys } from "./los-dev-tokens.js";

export interface MockLosUser {
  type: "staff" | "customer";
  /** The LOS userId (a positive integer; LOS numbers staff and customers separately). */
  userId: number;
  /** What the user types to sign in. */
  username: string;
  password: string;
  /** The name LOS puts in the token's `username` claim, shown in chat. */
  displayName: string;
  /** Staff only: the LOS role name, mapped to a chat role by LOS_STAFF_ROLE_MAP. */
  role?: string;
}

/** Every mock user signs in with this password. */
export const MOCK_PASSWORD = "password123";

/** The mock's people. Staff roles use LOS-style names, so LOS_STAFF_ROLE_MAP is exercised as it will be with LOS. */
export const DEFAULT_MOCK_USERS: readonly MockLosUser[] = [
  {
    type: "staff",
    userId: 1,
    username: "admin",
    password: MOCK_PASSWORD,
    displayName: "Chat Admin",
    role: "chat_admin",
  },
  {
    type: "staff",
    userId: 4,
    username: "agent4",
    password: MOCK_PASSWORD,
    displayName: "Agent Four",
    role: "loan_officer",
  },
  {
    type: "staff",
    userId: 5,
    username: "agent5",
    password: MOCK_PASSWORD,
    displayName: "Agent Five",
    role: "loan_officer",
  },
  {
    type: "staff",
    userId: 9,
    username: "supervisor9",
    password: MOCK_PASSWORD,
    displayName: "Supervisor Nine",
    role: "branch_manager",
  },
  { type: "customer", userId: 101, username: "dara", password: MOCK_PASSWORD, displayName: "Dara" },
  { type: "customer", userId: 102, username: "vanna", password: MOCK_PASSWORD, displayName: "Vanna" },
  { type: "customer", userId: 103, username: "bopha", password: MOCK_PASSWORD, displayName: "Bopha" },
];

/** The LOS_STAFF_ROLE_MAP that matches DEFAULT_MOCK_USERS. */
export const MOCK_STAFF_ROLE_MAP = "loan_officer:AGENT,branch_manager:SUPERVISOR,chat_admin:ADMIN";

/** `kid` of the mock's one signing key in its JWKS. */
const KEY_ID = "los-mock-1";

export interface MockLosOptions {
  keys: DevLosKeys;
  /** `iss` of its tokens; the chat backend's LOS_ISSUER. */
  issuer: string;
  customerAudience: string;
  handoffAudience: string;
  handoffTokenType: string;
  users?: readonly MockLosUser[];
}

const loginBody = z.object({ username: z.string().trim().min(1).max(100), password: z.string().min(1).max(128) });

const samePassword = (given: string, expected: string) => {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * The mock LOS as an Express app:
 * - `POST /customer/login { username, password }` → `{ losToken }`: the customer access token the mobile app holds
 *   (1 hour), for `POST /api/v1/customer/auth/los`.
 * - `POST /staff/login { username, password }` → `{ handoffToken }`: a single-use staff hand-off token for the chat
 *   dashboard (2 minutes), for `POST /api/v1/admin/auth/los`.
 * - `GET /.well-known/jwks.json`: the public key, for LOS_JWKS_URL.
 * - `GET /users`: who can sign in (usernames and roles, no passwords).
 */
export async function createLosMock(options: MockLosOptions) {
  const users = options.users ?? DEFAULT_MOCK_USERS;
  const publicJwk = await exportJWK(await importSPKI(options.keys.publicPem, "RS256", { extractable: true }));
  const jwks = { keys: [{ ...publicJwk, kid: KEY_ID, alg: "RS256", use: "sig" }] };

  const app = express();
  app.use(express.json());

  const signIn = (type: MockLosUser["type"]) => async (req: Request, res: Response) => {
    const body = loginBody.safeParse(req.body);
    if (!body.success) return void res.status(400).json({ error: "username and password are required" });
    const user = users.find((u) => u.type === type && u.username === body.data.username.toLowerCase());
    if (!user || !samePassword(body.data.password, user.password)) {
      return void res.status(401).json({ error: "Invalid username or password" });
    }
    const common = { issuer: options.issuer, userId: user.userId, username: user.displayName };
    if (type === "customer") {
      const losToken = await devCustomerToken(options.keys.privateKey, {
        ...common,
        audience: options.customerAudience,
        expiresIn: "1h",
      });
      return void res.json({ losToken, expiresIn: 3600 });
    }
    const handoffToken = await devHandoffToken(options.keys.privateKey, {
      ...common,
      audience: options.handoffAudience,
      tokenType: options.handoffTokenType,
      role: user.role ?? "",
      expiresIn: "2m",
    });
    res.json({ handoffToken, expiresIn: 120 });
  };

  app.post("/customer/login", signIn("customer"));
  app.post("/staff/login", signIn("staff"));
  app.get("/.well-known/jwks.json", (_req, res) => {
    res.json(jwks);
  });
  app.get("/users", (_req, res) => {
    res.json(users.map(({ password: _password, ...user }) => user));
  });
  return app;
}
