import { prisma, runInTransaction, type Db } from "@config/database.js";
import type { Call, CallParticipant } from "../../../prisma/generated/prisma/client.js";
import type { PartyType } from "./call.types.js";

export type CallRow = Call & { callParticipants: CallParticipant[] };

const include = { callParticipants: { orderBy: { id: "asc" as const } } };

export const isUniqueViolation = (error: unknown) =>
  typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";

export class CallRepository {
  constructor(private readonly db: Db = prisma) {}

  inTransaction<T>(fn: (repo: CallRepository) => Promise<T>): Promise<T> {
    return runInTransaction(this.db, (tx) => fn(new CallRepository(tx)));
  }

  findById(id: string): Promise<CallRow | null> {
    return this.db.call.findUnique({ where: { id }, include });
  }

  list(conversationId: string, skip: number, take: number) {
    return Promise.all([
      this.db.call.findMany({
        where: { conversationId },
        include,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip,
        take,
      }),
      this.db.call.count({ where: { conversationId } }),
    ]);
  }

  /** The call that is not over yet, if any. */
  findOpen(conversationId: string): Promise<CallRow | null> {
    return this.db.call.findFirst({
      where: { conversationId, status: { in: ["INITIATING", "RINGING", "ACTIVE"] } },
      include,
    });
  }

  /**
   * Creates a RINGING call with both parties. The initiator has joined; the other party has not yet. Throws a unique
   * violation when the conversation already has an open call (the partial unique index decides).
   */
  create(input: {
    conversationId: string;
    callType: string;
    initiator: { type: PartyType; id: string };
    callee: { type: PartyType; id: string } | null;
  }): Promise<CallRow> {
    return this.db.call.create({
      data: {
        conversationId: input.conversationId,
        callType: input.callType,
        initiatedByType: input.initiator.type,
        initiatedById: input.initiator.id,
        status: "RINGING",
        callParticipants: {
          create: [
            { participantType: input.initiator.type, participantId: input.initiator.id, joinedAt: new Date() },
            ...(input.callee ? [{ participantType: input.callee.type, participantId: input.callee.id }] : []),
          ],
        },
      },
      include,
    });
  }

  /** RINGING to ACTIVE. Null when someone else answered first or the call is over. */
  async activate(id: string): Promise<boolean> {
    const { count } = await this.db.call.updateMany({
      where: { id, status: "RINGING" },
      data: { status: "ACTIVE", startedAt: new Date() },
    });
    return count === 1;
  }

  /** Ends a call that is in one of the `from` states. False when it already moved on, so two actions cannot both win. */
  async finish(id: string, from: ("RINGING" | "ACTIVE")[], to: "ENDED" | "DECLINED" | "MISSED" | "CANCELLED") {
    const now = new Date();
    const { count } = await this.db.call.updateMany({
      where: { id, status: { in: from } },
      data: { status: to, endedAt: now },
    });
    if (count === 1) {
      await this.db.callParticipant.updateMany({
        where: { callId: id, leftAt: null, joinedAt: { not: null } },
        data: { leftAt: now },
      });
    }
    return count === 1;
  }

  /** Marks a party as joined, adding the row first when this party was not known yet (an agent answering). */
  async join(callId: string, party: { type: PartyType; id: string }) {
    const now = new Date();
    await this.db.callParticipant.upsert({
      where: { callId_participantType_participantId: { callId, participantType: party.type, participantId: party.id } },
      create: { callId, participantType: party.type, participantId: party.id, joinedAt: now },
      update: { joinedAt: now },
    });
  }

  /** Ringing calls older than `before` become MISSED. Claimed in one statement, so instances never share a call. */
  async claimUnanswered(before: Date, limit: number): Promise<CallRow[]> {
    return this.claim("RINGING", "MISSED", "created_at", before, limit);
  }

  /** Active calls that began before `before` become ENDED. */
  async claimOverlong(before: Date, limit: number): Promise<CallRow[]> {
    return this.claim("ACTIVE", "ENDED", "started_at", before, limit);
  }

  private async claim(from: string, to: string, column: "created_at" | "started_at", before: Date, limit: number) {
    const rows =
      column === "created_at"
        ? await this.db.$queryRaw<{ id: string }[]>`
            UPDATE calls SET status = ${to}, ended_at = now()
             WHERE status = ${from} AND id IN (SELECT id FROM calls WHERE status = ${from} AND created_at < ${before}
                           ORDER BY created_at LIMIT ${limit} FOR UPDATE SKIP LOCKED)
            RETURNING id`
        : await this.db.$queryRaw<{ id: string }[]>`
            UPDATE calls SET status = ${to}, ended_at = now()
             WHERE status = ${from} AND id IN (SELECT id FROM calls WHERE status = ${from} AND started_at < ${before}
                           ORDER BY started_at LIMIT ${limit} FOR UPDATE SKIP LOCKED)
            RETURNING id`;
    if (rows.length === 0) return [];
    await this.db.callParticipant.updateMany({
      where: { callId: { in: rows.map((row) => row.id) }, leftAt: null, joinedAt: { not: null } },
      data: { leftAt: new Date() },
    });
    return this.db.call.findMany({ where: { id: { in: rows.map((row) => row.id) } }, include });
  }

  async addActivity(
    conversationId: string,
    actor: { type: "AGENT" | "CUSTOMER" | "SYSTEM"; id: string | null },
    description: string,
    metadata: Record<string, string>,
  ) {
    await this.db.conversationActivity.create({
      data: { conversationId, actorType: actor.type, actorId: actor.id, activityType: "CALL", description, metadata },
    });
  }
}
