import { create } from "zustand";
import { API_URL, AUTH_SESSION_KEY, DEV_AUTH_TOKEN } from "@/shared/config";

/** The signed-in staff member, as `POST /auth/login` returns it (`docs/api-auth.md`). */
export type AuthUser = {
  id: string;
  /** The sign-in name; null for an account that signs in only with LOS. */
  username: string | null;
  /** Optional contact address. */
  email: string | null;
  displayName: string;
  role: string;
  status: string;
};

/** What sign-in, refresh and password change return, and what is kept in `localStorage[AUTH_SESSION_KEY]`. */
export type AuthSession = {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  user: AuthUser;
};

/** A refused auth request (`{ status: "error", error: { code, message } }`), or `status` 0 when the backend is unreachable. */
export class AuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/** Sign-in is needed only against the real backend, and not when a fixed development token is configured. */
export const authRequired = Boolean(API_URL) && !DEV_AUTH_TOKEN;

/** Refresh this long before the access token expires, so requests and reconnects never carry an expired one. */
const REFRESH_AHEAD_MS = 60_000;
/** After a failed refresh that was not a refusal (network), try again after this long. */
const RETRY_MS = 30_000;

export function readSession(): AuthSession | null {
  try {
    const raw = globalThis.localStorage?.getItem(AUTH_SESSION_KEY);
    const value = raw ? (JSON.parse(raw) as Partial<AuthSession>) : null;
    return value?.accessToken && value.refreshToken && value.user ? (value as AuthSession) : null;
  } catch {
    return null;
  }
}

type AuthState = {
  user: AuthUser | null;
  /** The last session ended because it ran out (not because the user signed out); cleared at the next sign-in. */
  sessionExpired: boolean;
};

/** The signed-in user, or `null`. Other tabs' sign-in and sign-out are followed through the `storage` event. */
export const useAuthStore = create<AuthState>(() => ({
  user: authRequired ? (readSession()?.user ?? null) : null,
  sessionExpired: false,
}));

function saveSession(session: AuthSession) {
  const { accessToken, accessTokenExpiresAt, refreshToken, refreshTokenExpiresAt, user } = session;
  try {
    globalThis.localStorage?.setItem(
      AUTH_SESSION_KEY,
      JSON.stringify({ accessToken, accessTokenExpiresAt, refreshToken, refreshTokenExpiresAt, user }),
    );
  } catch {
    /* Storage full or blocked: the session then lasts until the access token expires. */
  }
  useAuthStore.setState({ user, sessionExpired: false });
}

function clearSession() {
  try {
    globalThis.localStorage?.removeItem(AUTH_SESSION_KEY);
  } catch {
    /* nothing stored */
  }
  useAuthStore.setState({ user: null });
}

/** A POST to the staff auth endpoints. Separate from `apiRequest`, which itself relies on this module to refresh. */
async function post<T>(path: string, body: unknown): Promise<T | undefined> {
  if (!API_URL) throw new AuthError(0, "NOT_CONFIGURED", "The chat backend URL is not configured");
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AuthError(0, "NETWORK_ERROR", "Could not reach the chat backend");
  }
  if (response.status === 204) return undefined;
  let envelope: { status?: string; data?: T; error?: { code?: string; message?: string } } | undefined;
  try {
    envelope = await response.json();
  } catch {
    envelope = undefined;
  }
  if (!response.ok || envelope?.status !== "success") {
    throw new AuthError(
      response.status,
      envelope?.error?.code ?? "UNKNOWN_ERROR",
      envelope?.error?.message ?? `Request failed (${response.status})`,
    );
  }
  return envelope.data;
}

/** Signs a staff member in. Throws `AuthError` with the server's message (wrong password, locked, disabled, ...). */
export async function signIn(username: string, password: string): Promise<AuthUser> {
  const session = await post<AuthSession>("/auth/login", { username, password });
  if (!session) throw new AuthError(0, "UNKNOWN_ERROR", "Unexpected answer from the chat backend");
  saveSession(session);
  return session.user;
}

/** Signs a staff member in with a hand-off token from LOS Web (`POST /auth/los`). The token is not kept. */
export async function signInWithHandoff(handoffToken: string): Promise<AuthUser> {
  const session = await post<AuthSession>("/auth/los", { handoffToken });
  if (!session) throw new AuthError(0, "UNKNOWN_ERROR", "Unexpected answer from the chat backend");
  saveSession(session);
  return session.user;
}

/** Ends this sign-in on the server (best effort) and forgets it here and in every other tab. */
export async function signOut(): Promise<void> {
  const session = readSession();
  clearSession();
  if (session) await post("/auth/logout", { refreshToken: session.refreshToken }).catch(() => undefined);
}

let inflight: Promise<boolean> | null = null;

/** Runs `fn` while holding a lock shared by every tab of this origin, where the browser supports it. */
async function withTabLock(fn: () => Promise<boolean>): Promise<boolean> {
  const locks = globalThis.navigator?.locks;
  return locks ? await locks.request("auth.refresh", fn) : fn();
}

/**
 * Exchanges the refresh token for a new pair. The backend revokes the whole sign-in when a refresh token is used twice,
 * so only one refresh runs at a time (per tab, and across tabs with the Web Locks API), and a tab that finds another
 * tab already rotated the token simply adopts the new one. Resolves `false` (and signs out) when the server refuses;
 * rejects when the server cannot be reached, keeping the session.
 */
export function refreshSession(): Promise<boolean> {
  if (!inflight) {
    const before = readSession()?.refreshToken;
    inflight = withTabLock(() => rotate(before)).finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

async function rotate(before: string | undefined): Promise<boolean> {
  const current = readSession();
  if (!current) {
    clearSession();
    return false;
  }
  if (current.refreshToken !== before) {
    useAuthStore.setState({ user: current.user });
    return true;
  }
  try {
    const session = await post<AuthSession>("/auth/refresh", { refreshToken: current.refreshToken });
    if (!session) return false;
    saveSession(session);
    return true;
  } catch (error) {
    if (error instanceof AuthError && error.status === 401) {
      clearSession();
      if (error.code === "SESSION_EXPIRED") useAuthStore.setState({ sessionExpired: true });
      return false;
    }
    throw error;
  }
}

const expiresInMs = (session: AuthSession) => Date.parse(session.accessTokenExpiresAt) - Date.now();

/** Refreshes first when the access token is about to expire. Never throws; requests then fail on their own. */
export async function ensureFreshToken(): Promise<void> {
  if (!authRequired) return;
  const session = readSession();
  if (!session || expiresInMs(session) > 30_000) return;
  await refreshSession().catch(() => false);
}

/**
 * Keeps the session alive while the app runs: refreshes ahead of expiry, again when the tab becomes visible (timers
 * stall while a laptop sleeps), and follows sign-in/out in other tabs. Returns a teardown function.
 */
export function startSessionKeeper(): () => void {
  if (!authRequired || typeof window === "undefined") return () => {};
  let timer: number | undefined;

  const schedule = (delay?: number) => {
    window.clearTimeout(timer);
    const session = readSession();
    if (!session) return;
    timer = window.setTimeout(
      () => {
        refreshSession().then(
          () => schedule(),
          () => schedule(RETRY_MS),
        );
      },
      delay ?? Math.max(0, expiresInMs(session) - REFRESH_AHEAD_MS),
    );
  };

  const onStorage = (event: StorageEvent) => {
    if (event.key !== AUTH_SESSION_KEY && event.key !== null) return;
    useAuthStore.setState({ user: readSession()?.user ?? null });
    schedule();
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") void ensureFreshToken().then(() => schedule());
  };
  const unsubscribe = useAuthStore.subscribe((state, previous) => {
    if (state.user !== previous.user) schedule();
  });

  window.addEventListener("storage", onStorage);
  document.addEventListener("visibilitychange", onVisible);
  schedule();
  return () => {
    window.clearTimeout(timer);
    unsubscribe();
    window.removeEventListener("storage", onStorage);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
