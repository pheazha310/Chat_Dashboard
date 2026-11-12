import { logger } from "@config/logger.js";
import { AppError } from "@shared/errors/AppError.js";

/**
 * How Chat proves itself to LOS when it reads loan data. LOS has not built this yet (the announced
 * `/integration/chat/*` with an API key and IP allowlist), so there is no real strategy: `NoLosServiceAuth` refuses.
 * Never use a staff member's account as a stand-in, and never pass these headers to a browser or the mobile app.
 */
export interface LosServiceAuth {
  headers(): Promise<Record<string, string>>;
}

/**
 * The caller's own LOS access token, forwarded server-side for that customer's own data only (LOS endpoints under
 * `/customer/`). The token is used for the request and never stored or logged.
 */
export class BearerTokenAuth implements LosServiceAuth {
  constructor(private readonly token: string) {
    if (!token) throw new Error("A bearer token is required");
  }

  async headers() {
    return { authorization: `Bearer ${this.token}` };
  }
}

/** The default until LOS provides service authentication: every call is refused before any request is made. */
export class NoLosServiceAuth implements LosServiceAuth {
  async headers(): Promise<never> {
    throw new AppError(503, "LOS_DATA_UNAVAILABLE", "LOS loan data is not connected yet");
  }
}

/** The fields of an LOS application that chat shows (integration pack, 3.3). Nothing about the customer is copied. */
export interface LosApplicationSummary {
  id: number;
  /** An open string: LOS has more statuses than documented. Show unknown values as they are. */
  status: string;
  ticketNumber: string | null;
  /** As LOS sends it: Cambodia local time labelled `Z`, NOT true UTC. Not converted until the business confirms. */
  appliedDate: string | null;
  /** The closest field to a "product" (LOS has a single loan product). */
  loanPurpose: string | null;
  /** USD */
  requestedLoanSize: number | null;
  /** Days */
  requestedLoanTerm: number | null;
}

export interface LosDataClientOptions {
  /** `LOS_BASE_URL`, e.g. https://api-dev.los.delightech.asia/api/v1 */
  baseUrl: string;
  /** Path of one application by id, given by LOS once the service API exists. Without it `getApplication` is unavailable. */
  applicationPath?: (id: number) => string;
  auth: LosServiceAuth;
  timeoutMs?: number;
  fetcher?: (url: string, init: RequestInit) => Promise<Response>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const text = (value: unknown) => (typeof value === "string" ? value : null);
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** Reads loan data from LOS over HTTP. Used by services only; controllers never call LOS. */
export class LosDataClient {
  private readonly timeoutMs: number;
  private readonly fetcher: (url: string, init: RequestInit) => Promise<Response>;

  constructor(private readonly options: LosDataClientOptions) {
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
  }

  /** The application, or null when LOS does not know it. */
  async getApplication(id: number): Promise<LosApplicationSummary | null> {
    if (!Number.isInteger(id) || id <= 0) throw new AppError(400, "BAD_REQUEST", "Invalid application id");
    const { applicationPath } = this.options;
    if (!applicationPath) throw new AppError(503, "LOS_DATA_UNAVAILABLE", "LOS loan data is not connected yet");
    return this.read(applicationPath(id), false);
  }

  /** The customer's most recent application, read with their own token (`BearerTokenAuth`); null when they have none. */
  getLatestApplication(): Promise<LosApplicationSummary | null> {
    return this.read("/customer/application/latest", true);
  }

  private async read(path: string, emptyIsNull: boolean): Promise<LosApplicationSummary | null> {
    // Resolved first so an unconfigured strategy refuses before any request is made.
    const headers = await this.options.auth.headers();
    let response: Response;
    try {
      response = await this.fetcher(`${this.options.baseUrl}${path}`, {
        method: "GET",
        headers: { accept: "application/json", ...headers },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new AppError(504, "LOS_DATA_TIMEOUT", "LOS did not answer in time");
      }
      logger.warn({ err: error instanceof Error ? error.name : "unknown" }, "LOS request failed");
      throw new AppError(502, "LOS_DATA_ERROR", "LOS could not be reached");
    }
    if (response.status === 404) return null;
    // Only the status is logged: LOS bodies and our headers may hold tokens or customer data.
    if (!response.ok) {
      logger.warn({ status: response.status }, "LOS answered with an error");
      throw new AppError(502, "LOS_DATA_ERROR", "LOS returned an error");
    }
    const body: unknown = await response.json().catch(() => null);
    const data = isRecord(body) ? body.data : undefined;
    if (emptyIsNull && isRecord(body) && data === null) return null;
    if (!isRecord(data) || typeof data.id !== "number" || typeof data.status !== "string") {
      throw new AppError(502, "LOS_DATA_ERROR", "LOS returned an unexpected answer");
    }
    const detail = isRecord(data.loanDetail) ? data.loanDetail : {};
    return {
      id: data.id,
      status: data.status,
      ticketNumber: text(data.ticketNumber),
      appliedDate: text(data.appliedDate),
      loanPurpose: text(detail.loanPurpose),
      requestedLoanSize: num(detail.requestedLoanSize),
      requestedLoanTerm: num(detail.requestedLoanTerm),
    };
  }
}
