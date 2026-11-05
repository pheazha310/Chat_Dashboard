import { API_URL, getAuthToken } from "@/shared/config";

/** An error response from the backend (`{ status: "error", error: { code, message } }`) or a network failure. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type ApiResult<T, M = unknown> = { data: T; meta: M };

type Options = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  signal?: AbortSignal;
};

/** One request to the chat backend with the bearer token; unwraps the `{ status, data, meta }` envelope. */
export async function apiRequest<T, M = unknown>(path: string, options: Options = {}): Promise<ApiResult<T, M>> {
  if (!API_URL) throw new ApiError(0, "NOT_CONFIGURED", "The chat backend URL is not configured");
  const token = getAuthToken();
  const url = new URL(`${API_URL}${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, "NETWORK_ERROR", "Could not reach the chat backend");
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  const envelope = body as
    { status?: string; data?: T; meta?: M; error?: { code?: string; message?: string } } | undefined;

  if (!response.ok || envelope?.status !== "success") {
    throw new ApiError(
      response.status,
      envelope?.error?.code ?? "UNKNOWN_ERROR",
      envelope?.error?.message ?? `Request failed (${response.status})`,
    );
  }
  return { data: envelope.data as T, meta: envelope.meta as M };
}
