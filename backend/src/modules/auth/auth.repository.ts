import { prisma, runInTransaction, type Db } from "@config/database.js";
import { escapeLike } from "@shared/utils/like.js";
import { pageArgs } from "@shared/utils/pagination.js";
import type { ListUsersQuery } from "./auth.schema.js";
import type { UserRow } from "./auth.types.js";

const userSelect = {
  id: true,
  email: true,
  passwordHash: true,
  role: true,
  displayName: true,
  status: true,
  failedLoginCount: true,
  lockedUntil: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

/** True for a unique-constraint violation (a second account with the same email). */
export const isUniqueViolation = (error: unknown) =>
  typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";

/** `users` and `auth_sessions`. The only place that queries them. */
export class AuthRepository {
  constructor(private readonly db: Db = prisma) {}

  inTransaction<T>(fn: (repo: AuthRepository) => Promise<T>): Promise<T> {
    return runInTransaction(this.db, (tx) => fn(new AuthRepository(tx)));
  }

  // ─── users ─────────────────────────────────────────────────────────────────

  findUserByEmail(email: string): Promise<UserRow | null> {
    return this.db.authUser.findUnique({ where: { email }, select: userSelect });
  }

  findUserById(id: string): Promise<UserRow | null> {
    return this.db.authUser.findUnique({ where: { id }, select: userSelect });
  }

  findUsersByIds(ids: string[], roles: string[]): Promise<UserRow[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.db.authUser.findMany({ where: { id: { in: ids }, role: { in: roles } }, select: userSelect });
  }

  createUser(data: {
    email: string;
    passwordHash: string;
    role: string;
    displayName: string;
    createdBy: string | null;
  }): Promise<UserRow> {
    return this.db.authUser.create({ data, select: userSelect });
  }

  updateUser(
    id: string,
    data: { displayName?: string; role?: string; status?: string; lockedUntil?: null; failedLoginCount?: number },
  ): Promise<UserRow> {
    return this.db.authUser.update({ where: { id }, data, select: userSelect });
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
  }): Promise<void> {
    await this.db.authSession.create({ data });
  }

  findSessionByHash(tokenHash: string) {
    return this.db.authSession.findUnique({
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
    const { count } = await this.db.authSession.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count === 1;
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.db.authSession.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.db.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}
