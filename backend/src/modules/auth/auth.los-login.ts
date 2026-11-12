import { logger } from "@config/logger.js";
import { AppError } from "@shared/errors/AppError.js";

/** Turns a staff member's LOS username and password into the LOS access token this backend signs them in with. */
export interface LosStaffCredentials {
  /** The LOS access token, or null when LOS refuses the credentials or cannot be reached. */
  accessToken(username: string, password: string): Promise<string | null>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const looksLikeJwt = (value: unknown): value is string => typeof value === "string" && value.split(".").length === 3;

/** The first JWT-shaped string under a key matching `keyPattern` (LOS's response shape is only partly documented). */
function findToken(value: unknown, keyPattern: RegExp): string | null {
  if (!isRecord(value)) return null;
  for (const [key, inner] of Object.entries(value)) {
    if (keyPattern.test(key) && looksLikeJwt(inner)) return inner;
    const nested = findToken(inner, keyPattern);
    if (nested) return nested;
  }
  return null;
}

const TIMEOUT_MS = 8000;
/** After LOS could not be reached, how long staff sign-in skips it (so chat accounts are not delayed by the timeout). */
const OUTAGE_PAUSE_MS = 30_000;

/** 429 when LOS is limiting sign-ins; the staff member can try again shortly. */
export class LosRateLimitedError extends AppError {
  constructor() {
    super(429, "LOS_RATE_LIMITED", "LOS is limiting sign-ins right now; try again in a minute");
  }
}

/**
 * Checks a staff member's LOS username and password by logging in to LOS (`POST /admin/auth/login`) from the server and
 * returns the LOS access token it answers with. That token is then verified like any LOS token (signature, issuer,
 * audience, role map) before anyone is signed in. The password and token are used for this one request only: never
 * stored, never logged, never sent to a browser.
 */
export class LosStaffLogin implements LosStaffCredentials {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  /** Until when LOS is not asked, after it could not be reached. */
  private pausedUntil = 0;

  async accessToken(username: string, password: string): Promise<string | null> {
    if (this.now() < this.pausedUntil) return null;
    try {
      const login = await this.post("/admin/auth/login", { username, password });
      if (!login) return null;
      const token = findToken(login, /access/i);
      if (!token) logger.warn("LOS staff login answered without an access token");
      return token;
    } catch (error) {
      if (error instanceof LosRateLimitedError) throw error;
      this.pausedUntil = this.now() + OUTAGE_PAUSE_MS;
      logger.warn({ err: error instanceof Error ? error.message : "unknown" }, "LOS staff login unavailable");
      return null;
    }
  }

  /** The parsed JSON body of a 2xx answer, else null (a refusal is expected: the account may be a chat-only one). */
  private async post(path: string, body: unknown): Promise<unknown> {
    const response = await this.fetchFn(`${this.baseUrl.replace(/\/+$/, "")}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // LOS limits logins (and every login comes from this server): say so, a wrong-password message would mislead.
    if (response.status === 429) throw new LosRateLimitedError();
    if (response.status >= 500) throw new Error(`LOS answered ${response.status}`);
    if (!response.ok) {
      // Status only: a refusal is normal for a chat-only account.
      logger.info({ path, status: response.status }, "LOS staff login step refused");
      return null;
    }
    return response.json().catch(() => null);
  }
}
