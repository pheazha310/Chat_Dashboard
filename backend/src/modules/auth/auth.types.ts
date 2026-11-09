import type { Role } from "@shared/auth/auth.types.js";

/** Which sign-in endpoint is used: the dashboard (`/api/v1/admin/auth`) or the mobile app (`/api/v1/customer/auth`). */
export type Audience = "staff" | "customer";

export const STAFF_ROLES = ["AGENT", "SUPERVISOR", "ADMIN"] as const satisfies readonly Role[];
export const isStaffRole = (role: string) => (STAFF_ROLES as readonly string[]).includes(role);

export const USER_STATUSES = ["ACTIVE", "DISABLED"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const fitsAudience = (audience: Audience, role: string) =>
  audience === "customer" ? role === "CUSTOMER" : isStaffRole(role);

/** Where a request came from, kept on the session for the user's "signed-in devices". */
export interface ClientInfo {
  userAgent?: string | undefined;
  ipAddress?: string | undefined;
}

/** A user as the API returns it. Never carries the password hash or lockout counters. */
export interface UserDto {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  status: UserStatus;
  lastLoginAt: string | null;
  createdAt: string;
}

/** The answer to sign-in, registration, refresh and password change. */
export interface AuthTokensDto {
  tokenType: "Bearer";
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  user: UserDto;
}

/** The `users` columns the services read. */
export interface UserRow {
  id: string;
  email: string;
  passwordHash: string;
  role: string;
  displayName: string;
  status: string;
  failedLoginCount: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export interface AuthOptions {
  refreshTtlMs: number;
  /** Failed sign-ins in a row before the account is locked. */
  maxFailedLogins: number;
  lockMs: number;
}

export const DEFAULT_AUTH_OPTIONS: AuthOptions = {
  refreshTtlMs: 30 * 24 * 60 * 60 * 1000,
  maxFailedLogins: 5,
  lockMs: 15 * 60 * 1000,
};

export const toUser = (row: UserRow): UserDto => ({
  id: row.id,
  email: row.email,
  displayName: row.displayName,
  role: row.role as Role,
  status: row.status as UserStatus,
  lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
});
