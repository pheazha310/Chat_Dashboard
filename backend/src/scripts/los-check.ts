/**
 * Check the real LOS connection end to end for a customer. Run from the repo root with the backend running and
 * LOS_ISSUER / LOS_JWKS_URL set in backend/.env:
 *
 *   LOS_TEST_USERNAME=<username> LOS_TEST_PIN=1234 pnpm --filter @chat-dashboard/backend los:check
 *
 * It logs in to LOS (LOS_API_BASE, default the Dev API), then sends the LOS access token to this backend's
 * POST /customer/auth/los. Tokens and the PIN are never printed. The LOS login body is `username` + `password` (a 4-digit PIN),
 * as the Dev API requires; if LOS rejects it the script prints LOS's own message.
 * LOS limits customer logins to 5 per 15 minutes, so do not loop this.
 */
import "dotenv/config";

const LOS_BASE = process.env.LOS_API_BASE ?? "https://api-dev.los.delightech.asia/api/v1";
const API = `http://localhost:${process.env.PORT ?? 4000}`;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** The first string under a key containing "access" (the exact LOS response shape is not documented). */
function findAccessToken(value: unknown): string | null {
  if (!isRecord(value)) return null;
  for (const [key, inner] of Object.entries(value)) {
    if (typeof inner === "string" && /access/i.test(key) && inner.split(".").length === 3) return inner;
    const nested = findAccessToken(inner);
    if (nested) return nested;
  }
  return null;
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to run with NODE_ENV=production.");
  const { LOS_TEST_USERNAME: username, LOS_TEST_PIN: pin } = process.env;
  if (!username || !pin) throw new Error("Set LOS_TEST_USERNAME and LOS_TEST_PIN in the environment.");

  const login = await fetch(`${LOS_BASE}/customer/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: pin }),
  });
  const loginBody: unknown = await login.json().catch(() => null);
  console.log(`LOS login: HTTP ${login.status}`);
  const losToken = findAccessToken(loginBody);
  if (!login.ok || !losToken) {
    const message = isRecord(loginBody) && isRecord(loginBody.error) ? loginBody.error.message : undefined;
    throw new Error(`LOS login failed${message ? `: ${String(message)}` : ""} (no access token found in the response)`);
  }

  const response = await fetch(`${API}/api/v1/customer/auth/los`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ losToken }),
  });
  const body: unknown = await response.json().catch(() => null);
  console.log(`Chat /customer/auth/los: HTTP ${response.status}`);
  if (response.ok && isRecord(body) && isRecord(body.data) && isRecord(body.data.user)) {
    const { id, role, losUserId } = body.data.user as Record<string, unknown>;
    console.log(`Signed in: chat user ${String(id)}, role ${String(role)}, LOS user ${String(losUserId)}`);
  } else if (isRecord(body) && isRecord(body.error)) {
    console.log(`Error: ${String(body.error.code)} ${String(body.error.message)}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
