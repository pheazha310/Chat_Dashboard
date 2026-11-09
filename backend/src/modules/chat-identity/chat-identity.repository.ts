import { prisma, type Db } from "@config/database.js";

const withPermissions = {
  role: {
    select: { name: true, rolePermissions: { select: { permission: { select: { module: true, action: true } } } } },
  },
} as const;

/** `chat_users`. Rows are keyed by `external_id` (= users.id); the role is linked by name to `roles`. */
export class ChatIdentityRepository {
  constructor(private readonly db: Db = prisma) {}

  /**
   * Finds the chat user for a verified identity or creates it, in one atomic statement (two first sign-ins at once
   * end up with one row). The kind and role are refreshed and `lastSeenAt` moved; `status` is never touched here.
   * Returns the role's permissions too.
   */
  upsert(userType: string, externalId: string, role: string) {
    return this.db.chatUser.upsert({
      where: { externalId },
      create: { userType, externalId, role: { connect: { name: role } } },
      update: { userType, role: { connect: { name: role } }, lastSeenAt: new Date() },
      select: { id: true, status: true, ...withPermissions },
    });
  }

  /** Creates the row if missing (e.g. a customer an agent opens a conversation for), changing nothing otherwise. */
  async ensure(userType: string, externalId: string, role: string): Promise<void> {
    await this.db.chatUser.upsert({
      where: { externalId },
      create: { userType, externalId, role: { connect: { name: role } } },
      update: {},
      select: { id: true },
    });
  }

  /** Copies account details (name, role, kind) from `users`, creating the row if the person never signed in yet. */
  async sync(userType: string, externalId: string, role: string, username: string): Promise<void> {
    await this.db.chatUser.upsert({
      where: { externalId },
      create: { userType, externalId, username, role: { connect: { name: role } } },
      update: { userType, username, role: { connect: { name: role } } },
      select: { id: true },
    });
  }

  /** Sets the status, creating the row if the user never signed in yet (so a disabled account is refused at once). */
  async setStatus(userType: string, externalId: string, role: string, status: string): Promise<void> {
    await this.db.chatUser.upsert({
      where: { externalId },
      create: { userType, externalId, status, role: { connect: { name: role } } },
      update: { status },
      select: { id: true },
    });
  }
}
