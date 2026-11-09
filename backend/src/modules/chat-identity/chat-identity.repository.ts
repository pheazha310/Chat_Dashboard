import { prisma, type Db } from "@config/database.js";

const withPermissions = {
  role: {
    select: { name: true, rolePermissions: { select: { permission: { select: { module: true, action: true } } } } },
  },
} as const;

/**
 * `chat_users`. Rows are keyed by `external_id` (= users.id); the role is linked by name to `roles`. Connecting the role
 * also sets `user_type` to the role's `kind` (composite FK to roles (id, kind)), so the kind is never written apart.
 */
export class ChatIdentityRepository {
  constructor(private readonly db: Db = prisma) {}

  /**
   * Finds the chat user for a verified identity or creates it, in one atomic statement (two first sign-ins at once
   * end up with one row). The role (and so the kind) is refreshed and `lastSeenAt` moved; `status` is never touched here.
   * Returns the role's permissions too.
   */
  upsert(externalId: string, role: string) {
    return this.db.chatUser.upsert({
      where: { externalId },
      create: { externalId, role: { connect: { name: role } } },
      update: { role: { connect: { name: role } }, lastSeenAt: new Date() },
      select: { id: true, status: true, ...withPermissions },
    });
  }

  /** Creates the row if missing (e.g. a customer an agent opens a conversation for), changing nothing otherwise. */
  async ensure(externalId: string, role: string): Promise<void> {
    await this.db.chatUser.upsert({
      where: { externalId },
      create: { externalId, role: { connect: { name: role } } },
      update: {},
      select: { id: true },
    });
  }

  /**
   * Copies account details (name, role and hence kind, and the LOS userId when known) from `users`, creating the row
   * if the person never signed in yet. A missing `losUserId` leaves the stored one unchanged.
   */
  async sync(externalId: string, role: string, username: string, losUserId?: number | null): Promise<void> {
    const los = losUserId === undefined || losUserId === null ? {} : { losUserId };
    await this.db.chatUser.upsert({
      where: { externalId },
      create: { externalId, username, ...los, role: { connect: { name: role } } },
      update: { username, ...los, role: { connect: { name: role } } },
      select: { id: true },
    });
  }

  /** Sets the status, creating the row if the user never signed in yet (so a disabled account is refused at once). */
  async setStatus(externalId: string, role: string, status: string): Promise<void> {
    await this.db.chatUser.upsert({
      where: { externalId },
      create: { externalId, status, role: { connect: { name: role } } },
      update: { status },
      select: { id: true },
    });
  }
}
