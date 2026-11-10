/**
 * Test "sign in with LOS" without LOS. Run from the repo root:
 *
 *   pnpm los:token setup                          # once: prints the two .env lines that make the server trust it
 *   pnpm los:token customer [userId] [username]   # a customer token for POST /api/v1/customer/auth/los
 *   pnpm los:token staff [userId] [username] [role]  # a hand-off token for POST /api/v1/admin/auth/los
 *
 * Defaults: customer 1 "Test LOS Customer"; staff 1 "Test LOS Agent" agent. A hand-off token works once (sign in
 * again with a new one). The key pair lives in backend/.los-dev/ (git-ignored). Refuses NODE_ENV=production.
 */
import "dotenv/config";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  DEV_LOS_ISSUER,
  devCustomerToken,
  devEnvLines,
  devHandoffToken,
  loadOrCreateDevKeys,
} from "./los-dev-tokens.js";

const KEY_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".los-dev");
const API = `http://localhost:${process.env.PORT ?? 4000}`;

const USAGE = `Usage:
  pnpm los:token setup
  pnpm los:token customer [userId] [username]
  pnpm los:token staff [userId] [username] [role]   (role: agent, supervisor, or a name mapped in LOS_STAFF_ROLE_MAP)`;

function userIdFrom(value: string | undefined): number {
  const id = Number(value ?? 1);
  if (!Number.isInteger(id) || id <= 0 || id > 2 ** 31 - 1)
    throw new Error(`userId must be a positive integer: ${value}`);
  return id;
}

async function main() {
  if (process.env.NODE_ENV === "production")
    throw new Error("Refusing to make test LOS tokens with NODE_ENV=production.");
  const [command, id, name, role] = process.argv.slice(2);
  const keys = await loadOrCreateDevKeys(KEY_DIR);
  const issuer = process.env.LOS_ISSUER || DEV_LOS_ISSUER;

  if (command === "setup") {
    console.log("Add these lines to backend/.env, then restart the backend (pnpm dev:backend):\n");
    console.log(devEnvLines(issuer, keys.publicPem).join("\n"));
    if (process.env.LOS_JWKS_URL) console.log("\nAlso remove LOS_JWKS_URL: it takes precedence over LOS_PUBLIC_KEY.");
    return;
  }
  if (command === "customer") {
    const token = await devCustomerToken(keys.privateKey, {
      issuer,
      audience: process.env.LOS_CUSTOMER_AUDIENCE || "luyleun",
      userId: userIdFrom(id),
      username: name ?? "Test LOS Customer",
      expiresIn: "1h",
    });
    print(token, `${API}/api/v1/customer/auth/los`, { losToken: token }, "valid 1 hour, reusable");
    return;
  }
  if (command === "staff") {
    const token = await devHandoffToken(keys.privateKey, {
      issuer,
      audience: process.env.LOS_HANDOFF_AUDIENCE || "chat",
      tokenType: process.env.LOS_HANDOFF_TOKEN_TYPE || "chat-handoff",
      userId: userIdFrom(id),
      username: name ?? "Test LOS Agent",
      role: role ?? "agent",
      expiresIn: "10m",
    });
    print(token, `${API}/api/v1/admin/auth/los`, { handoffToken: token }, "valid 10 minutes, works once");
    return;
  }
  console.error(USAGE);
  process.exitCode = 1;
}

function print(token: string, url: string, body: Record<string, string>, note: string) {
  console.log(`Token (${note}):\n\n${token}\n`);
  console.log(`Try it:\n\ncurl -s -X POST ${url} -H 'content-type: application/json' -d '${JSON.stringify(body)}'\n`);
  if (!process.env.LOS_ISSUER)
    console.log("LOS_ISSUER is not set in backend/.env yet: run `pnpm los:token setup` first.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
