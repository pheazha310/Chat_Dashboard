import { prisma, type Db } from "@config/database.js";

export class ChatIdentityRepository {
  constructor(private readonly db: Db = prisma) {}

  /**
   * Finds the chat user for a Backend 1 identity or creates it, in one atomic statement (two first sign-ins at once
   * end up with one row). The role is refreshed and `lastSeenAt` moved; `status` is never touched here.
   */
  upsert(userType: string, externalId: string, role: string) {
    return this.db.chatUser.upsert({
      where: { userType_externalId: { userType, externalId } },
      create: { userType, externalId, role },
      update: { role, lastSeenAt: new Date() },
    });
  }
}
