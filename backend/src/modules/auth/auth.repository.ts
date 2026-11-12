import { prisma, runInTransaction, type Db } from "@config/database.js";
import { escapeLike } from "@shared/utils/like.js";
import { pageArgs } from "@shared/utils/pagination.js";
import type { ListUsersQuery } from "./auth.schema.js";
import type { CustomerFields, StaffFields, UserRow } from "./auth.types.js";

const userSelect = {
  id: true,
  username: true,
  email: true,
  passwordHash: true,
  losUserId: true,
  losUserType: true,
  role: true,
  displayName: true,
  status: true,
  failedLoginCount: true,
  lockedUntil: true,
  lastLoginAt: true,
  createdAt: true,
  staff: { select: { employeeCode: true, department: true, maxConcurrentChats: true } },
  customer: { select: { phone: true, customerCode: true, preferredLanguage: true } },
} as const;

/** True for a unique-constraint violation (a second account with the same username). */
export const isUniqueViolation = (error: unknown) =>
  typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";

/**
 * True for a unique-constraint violation on `column` (e.g. `employee_code`). The driver adapter reports the columns in
 * different places depending on the version, so the error's metadata is searched as a whole.
 */
export const isUniqueViolationOn = (error: unknown, column: string) =>
  isUniqueViolation(error) && JSON.stringify((error as { meta?: unknown }).meta ?? {}).includes(column);

/**
 * The profile row created with an account: `customers` for a CUSTOMER, `staff` for every other role. Every account has
 * exactly one of them.
 */
const profileFor = (role: string, staff?: Partial<StaffFields>) =>
  role === "CUSTOMER" ? { customer: { create: {} } } : { staff: { create: { ...staff } } };

/** Profile changes as nested upserts (the row normally exists; an upsert also repairs one that does not). */
const profileUpdates = (data: { staff?: Partial<StaffFields>; customer?: Partial<CustomerFields> }) => ({
  ...(data.staff ? { staff: { upsert: { create: data.staff, update: data.staff } } } : {}),
  ...(data.customer ? { customer: { upsert: { create: data.customer, update: data.customer } } } : {}),
});

/** `users` and `refresh_tokens`. The only place that queries them. */
export class AuthRepository {
  constructor(private readonly db: Db = prisma) {}

  inTransaction<T>(fn: (repo: AuthRepository) => Promise<T>): Promise<T> {
    return runInTransaction(this.db, (tx) => fn(new AuthRepository(tx)));
  }

  // ─── users ─────────────────────────────────────────────────────────────────

  findUserByUsername(username: string): Promise<UserRow | null> {
    return this.db.authUser.findUnique({ where: { username }, select: userSelect });
  }

  findUserByLos(losUserType: string, losUserId: number): Promise<UserRow | null> {
    return this.db.authUser.findUnique({
      where: { losUserType_losUserId: { losUserType, losUserId } },
      select: userSelect,
    });
  }

  /** An account that signs in only through LOS: no username, no password. Created with its profile row. */
  createLosUser(data: { losUserType: string; losUserId: number; role: string; displayName: string }): Promise<UserRow> {
    return this.db.authUser.create({
      data: { ...data, createdBy: null, ...profileFor(data.role) },
      select: userSelect,
    });
  }

  findUserById(id: string): Promise<UserRow | null> {
    return this.db.authUser.findUnique({ where: { id }, select: userSelect });
  }

  findUsersByIds(ids: string[], roles: string[]): Promise<UserRow[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.db.authUser.findMany({ where: { id: { in: ids }, role: { in: roles } }, select: userSelect });
  }

  /** Creates the account and its profile row together (`staff` fields apply to staff roles only). */
  createUser(data: {
    username: string;
    email?: string | undefined;
    passwordHash: string;
    role: string;
    displayName: string;
    createdBy: string | null;
    staff?: Partial<StaffFields>;
  }): Promise<UserRow> {
    const { staff, ...user } = data;
    return this.db.authUser.create({ data: { ...user, ...profileFor(user.role, staff) }, select: userSelect });
  }

  updateUser(
    id: string,
    data: {
      displayName?: string;
      role?: string;
      status?: string;
      lockedUntil?: null;
      failedLoginCount?: number;
      staff?: Partial<StaffFields>;
      customer?: Partial<CustomerFields>;
    },
  ): Promise<UserRow> {
    const { staff, customer, ...user } = data;
    return this.db.authUser.update({
      where: { id },
      data: { ...user, ...profileUpdates({ staff, customer }) },
      select: userSelect,
    });
  }

  async setPassword(id: string, passwordHash: string): Promise<void> {
    await this.db.authUser.update({
      where: { id },
      data: { passwordHash, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null },
    });
  }

  /**
   * One more failed sign-in, in a single statement so parallel guesses all count. Locks the account until `lockUntil`
   * once the count reaches `maxFailures` (the count restarts after the lock).
   */
  async recordFailedLogin(id: string, maxFailures: number, lockUntil: Date): Promise<void> {
    await this.db.$executeRaw`
      UPDATE users
      SET failed_login_count = CASE WHEN failed_login_count + 1 >= ${maxFailures} THEN 0 ELSE failed_login_count + 1 END,
          locked_until = CASE WHEN failed_login_count + 1 >= ${maxFailures} THEN ${lockUntil} ELSE locked_until END,
          updated_at = now()
      WHERE id = ${id}::uuid`;
  }

  async recordSuccessfulLogin(id: string): Promise<void> {
    await this.db.authUser.update({
      where: { id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
  }

  async listUsers(query: ListUsersQuery): Promise<{ items: UserRow[]; total: number }> {
    const q = query.q === undefined ? undefined : escapeLike(query.q);
    const where = {
      ...(query.role === undefined ? {} : { role: query.role }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(q === undefined
        ? {}
        : {
            OR: [
              { username: { contains: q, mode: "insensitive" as const } },
              { email: { contains: q, mode: "insensitive" as const } },
              { displayName: { contains: q, mode: "insensitive" as const } },
            ],
          }),
    };
    const [items, total] = await Promise.all([
      this.db.authUser.findMany({
        where,
        select: userSelect,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        ...pageArgs(query),
      }),
      this.db.authUser.count({ where }),
    ]);
    return { items, total };
  }

  // ─── sessions ──────────────────────────────────────────────────────────────

  async createSession(data: {
    userId: string;
    familyId: string;
    tokenHash: string;
    expiresAt: Date;
    userAgent: string | null;
    ipAddress: string | null;
  }): Promise<{ id: string }> {
    return this.db.refreshToken.create({ data, select: { id: true } });
  }

  /** Links a rotated (already revoked) session to the session that replaced it. */
  async markReplaced(id: string, replacedById: string): Promise<void> {
    await this.db.refreshToken.update({ where: { id }, data: { replacedById } });
  }

  findSessionByHash(tokenHash: string) {
    return this.db.refreshToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        familyId: true,
        expiresAt: true,
        revokedAt: true,
        user: { select: userSelect },
      },
    });
  }

  /** Revokes one session if it is still live. False when another request revoked (rotated) it first. */
  async revokeIfActive(id: string): Promise<boolean> {
    const { count } = await this.db.refreshToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count === 1;
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.db.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  /** Deletes the user's sessions that expired (they can no longer be used, so nothing is lost). Returns how many. */
  async deleteExpiredSessions(userId: string, now: Date): Promise<number> {
    const { count } = await this.db.refreshToken.deleteMany({ where: { userId, expiresAt: { lt: now } } });
    return count;
  }

  /**
   * Deletes up to `limit` expired sessions of any user (the cleanup job). Batched, so a large backlog never holds a
   * long lock. Returns how many rows went.
   */
  deleteExpiredSessionsBatch(now: Date, limit: number): Promise<number> {
    return this.db.$executeRaw`
      DELETE FROM refresh_tokens
      WHERE id IN (SELECT id FROM refresh_tokens WHERE expires_at < ${now} LIMIT ${limit})`;
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.db.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}
