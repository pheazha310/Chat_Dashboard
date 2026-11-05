import { prisma, type Db } from "@config/database.js";

export class CustomerRepository {
  constructor(private readonly db: Db = prisma) {}

  /** Everyone who has been in the conversation, current members first. */
  participants(conversationId: bigint) {
    return this.db.conversationParticipant.findMany({
      where: { conversationId },
      orderBy: [{ leftAt: { sort: "asc", nulls: "first" } }, { joinedAt: "asc" }, { id: "asc" }],
    });
  }
}
