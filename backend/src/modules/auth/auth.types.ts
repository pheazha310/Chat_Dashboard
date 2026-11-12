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

/** The `staff` row of a staff account (AGENT, SUPERVISOR, ADMIN). */
export interface StaffFields {
  employeeCode: string | null;
  department: string | null;
  /** Most open chats this person should own at once; null = no limit. Stored only, not yet enforced. */
  maxConcurrentChats: number | null;
}

/** The `customers` row of a CUSTOMER account. */
export interface CustomerFields {
  /** E.164, e.g. +85512345678. */
  phone: string | null;
  /** The customer's code in the loan system (LOS). */
  customerCode: string | null;
  /** BCP 47 tag, e.g. km or en. */
  preferredLanguage: string | null;
}

/** A user as the API returns it. Never carries the password hash or lockout counters. */
export interface UserDto {
  id: string;
  /** Null for an account that only signs in through LOS. */
  email: string | null;
  /** The LOS userId when the account is linked to LOS. */
  losUserId: number | null;
  displayName: string;
  role: Role;
  status: UserStatus;
  lastLoginAt: string | null;
  createdAt: string;
  /** Staff accounts: the `staff` row; null for customers. */
  staff: StaffFields | null;
  /** Customer accounts: the `customers` row; null for staff. */
  customer: CustomerFields | null;
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
  email: string | null;
  passwordHash: string | null;
  losUserId: number | null;
  losUserType: string | null;
  role: string;
  displayName: string;
  status: string;
  failedLoginCount: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  staff: StaffFields | null;
  customer: CustomerFields | null;
}

export interface AuthOptions {
  refreshTtlMs: number;
  /**
   * How long a staff session started by an LOS hand-off lasts (refreshing does not extend it). After it the dashboard
   * must fetch a new hand-off from LOS, which refuses suspended staff and reports a changed role. Unset: `refreshTtlMs`.
   */
  losStaffSessionMs?: number;
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
  losUserId: row.losUserId,
  displayName: row.displayName,
  role: row.role as Role,
  status: row.status as UserStatus,
  lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  staff: row.staff ? { ...row.staff } : null,
  customer: row.customer ? { ...row.customer } : null,
});
