/**
 * Runs the mock LOS (los-mock-app.ts) so "sign in with LOS" works for real before LOS is connected:
 *
 *   pnpm los:mock          # http://localhost:4500
 *   pnpm los:mock 4600     # another port
 *
 * On start it prints the lines to put in backend/.env and the users who can sign in (password: password123).
 * The key pair is shared with `pnpm los:token` (backend/.los-dev/, git-ignored). Refuses NODE_ENV=production.
 */
import "dotenv/config";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadOrCreateDevKeys } from "./los-dev-tokens.js";
import { createLosMock, DEFAULT_MOCK_USERS, MOCK_PASSWORD, MOCK_STAFF_ROLE_MAP } from "./los-mock-app.js";

const KEY_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".los-dev");

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to run the mock LOS with NODE_ENV=production.");
  const port = Number(process.argv[2] ?? 4500);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`Not a port: ${process.argv[2]}`);
  const issuer = `http://localhost:${port}`;

  const app = await createLosMock({
    keys: await loadOrCreateDevKeys(KEY_DIR),
    issuer,
    customerAudience: process.env.LOS_CUSTOMER_AUDIENCE || "luyleun",
    handoffAudience: process.env.LOS_HANDOFF_AUDIENCE || "chat",
    handoffTokenType: process.env.LOS_HANDOFF_TOKEN_TYPE || "chat-handoff",
  });
  app.listen(port, () => {
    console.log(`Mock LOS on ${issuer}\n`);
    console.log("backend/.env (then restart the backend; remove LOS_PUBLIC_KEY if you set it):\n");
    console.log(`LOS_ISSUER=${issuer}`);
    console.log(`LOS_JWKS_URL=${issuer}/.well-known/jwks.json`);
    console.log(`LOS_STAFF_ROLE_MAP=${MOCK_STAFF_ROLE_MAP}\n`);
    console.log(`Users (password: ${MOCK_PASSWORD}):`);
    for (const user of DEFAULT_MOCK_USERS) {
      console.log(
        `  ${user.type.padEnd(8)} ${user.username.padEnd(12)} ${user.displayName} (LOS ${user.userId}${user.role ? `, ${user.role}` : ""})`,
      );
    }
    console.log(`\n  staff:    POST ${issuer}/staff/login    → handoffToken → POST /api/v1/admin/auth/los`);
    console.log(`  customer: POST ${issuer}/customer/login → losToken     → POST /api/v1/customer/auth/los`);
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
