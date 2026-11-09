import { randomUUID } from "node:crypto";
import type { AuthRepository } from "../auth.repository.js";
import type { ListUsersQuery } from "../auth.schema.js";
import type { UserRow } from "../auth.types.js";

interface SessionRow {
  id: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedById: string | null;
  userAgent: string | null;
  ipAddress: string | null;
}

/** In-memory stand-in for `AuthRepository` with the same observable behaviour, for service unit tests. */
export class FakeAuthRepository {
  users = new Map<string, UserRow & { passwordChangedAt?: Date }>();
  sessions: SessionRow[] = [];
  /** Makes the next `revokeIfActive` lose the race, as if a parallel refresh rotated the token first. */
  loseNextRotation = false;

  asRepository() {
    return this as unknown as AuthRepository;
  }

  async inTransaction<T>(fn: (repo: AuthRepository) => Promise<T>): Promise<T> {
    // Transactions are all-or-nothing: snapshot, and restore on failure.
    const users = new Map([...this.users].map(([k, v]) => [k, { ...v }]));
    const sessions = this.sessions.map((s) => ({ ...s }));
    try {
      return await fn(this.asRepository());
    } catch (error) {
      this.users = users;
      this.sessions = sessions;
      throw error;
    }
  }

  async findUserByEmail(email: string) {
    return [...this.users.values()].find((u) => u.email === email) ?? null;
  }

  async findUserById(id: string) {
    return this.users.get(id) ?? null;
  }

  async findUsersByIds(ids: string[], roles: string[]) {
    return ids.flatMap((id) => {
      const user = this.users.get(id);
      return user && roles.includes(user.role) ? [user] : [];
    });
  }

  async findUserByLos(losUserType: string, losUserId: number) {
    return [...this.users.values()].find((u) => u.losUserType === losUserType && u.losUserId === losUserId) ?? null;
  }

  async createLosUser(data: { losUserType: string; losUserId: number; role: string; displayName: string }) {
    if (await this.findUserByLos(data.losUserType, data.losUserId)) {
      throw Object.assign(new Error("unique"), { code: "P2002" });
    }
    const row: UserRow = {
      id: randomUUID(),
      email: null,
      passwordHash: null,
      status: "ACTIVE",
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: null,
      createdAt: new Date(),
      ...data,
    };
    this.users.set(row.id, row);
    return row;
  }

  async createUser(data: { email: string; passwordHash: string; role: string; displayName: string }) {
    if (await this.findUserByEmail(data.email)) throw Object.assign(new Error("unique"), { code: "P2002" });
    const row: UserRow & { email: string; passwordHash: string } = {
      id: randomUUID(),
      losUserId: null,
      losUserType: null,
      status: "ACTIVE",
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: null,
      createdAt: new Date(),
      ...data,
    };
    this.users.set(row.id, row);
    return row;
  }

  async updateUser(id: string, data: Partial<UserRow>) {
    const user = this.users.get(id);
    if (!user) throw Object.assign(new Error("missing"), { code: "P2025" });
    Object.assign(user, data);
    return user;
  }

  async setPassword(id: string, passwordHash: string) {
    await this.updateUser(id, { passwordHash, failedLoginCount: 0, lockedUntil: null });
  }

  async recordFailedLogin(id: string, max: number, lockUntil: Date) {
    const user = this.users.get(id);
    if (!user) return;
    if (user.failedLoginCount + 1 >= max) {
      user.failedLoginCount = 0;
      user.lockedUntil = lockUntil;
    } else user.failedLoginCount += 1;
  }

  async recordSuccessfulLogin(id: string) {
    await this.updateUser(id, { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() });
  }

  async listUsers(query: ListUsersQuery) {
    const items = [...this.users.values()].filter(
      (u) => (!query.role || u.role === query.role) && (!query.status || u.status === query.status),
    );
    return { items, total: items.length };
  }

  async createSession(data: Omit<SessionRow, "id" | "revokedAt" | "replacedById">) {
    const id = randomUUID();
    this.sessions.push({ id, revokedAt: null, replacedById: null, ...data });
    return { id };
  }

  async markReplaced(id: string, replacedById: string) {
    const session = this.sessions.find((s) => s.id === id);
    if (!session?.revokedAt || id === replacedById) throw new Error("only a revoked session can be replaced"); // CHECKs
    session.replacedById = replacedById;
  }

  async findSessionByHash(tokenHash: string) {
    const session = this.sessions.find((s) => s.tokenHash === tokenHash);
    if (!session) return null;
    return { ...session, user: this.users.get(session.userId) as UserRow };
  }

  async revokeIfActive(id: string) {
    const session = this.sessions.find((s) => s.id === id && s.revokedAt === null);
    if (!session || this.loseNextRotation) {
      this.loseNextRotation = false;
      return false;
    }
    session.revokedAt = new Date();
    return true;
  }

  async revokeFamily(familyId: string) {
    for (const s of this.sessions) if (s.familyId === familyId && !s.revokedAt) s.revokedAt = new Date();
  }

  async deleteExpiredSessions(userId: string, now: Date) {
    const before = this.sessions.length;
    this.sessions = this.sessions.filter((s) => s.userId !== userId || s.expiresAt >= now);
    return before - this.sessions.length;
  }

  async deleteExpiredSessionsBatch(now: Date, limit: number) {
    const expired = this.sessions.filter((s) => s.expiresAt < now).slice(0, limit);
    this.sessions = this.sessions.filter((s) => !expired.includes(s));
    return expired.length;
  }

  async revokeAllForUser(userId: string) {
    for (const s of this.sessions) if (s.userId === userId && !s.revokedAt) s.revokedAt = new Date();
  }

  live(userId?: string) {
    return this.sessions.filter((s) => !s.revokedAt && (userId === undefined || s.userId === userId));
  }
}
