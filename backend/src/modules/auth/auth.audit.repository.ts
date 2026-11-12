import { prisma, type Db } from "@config/database.js";
import { logger } from "@config/logger.js";
import type { AuthAuditEvent, AuthAuditLog } from "./auth.audit.js";

/** `auth_audit_events`. Append-only, and best effort: a failed write is logged, never thrown. */
export class AuthAuditRepository implements AuthAuditLog {
  constructor(private readonly db: Db = prisma) {}

  async record(event: AuthAuditEvent): Promise<void> {
    try {
      await this.db.authAuditEvent.create({
        data: {
          event: event.event,
          provider: event.provider,
          outcome: event.outcome,
          userId: event.userId ?? null,
          actorId: event.actorId ?? null,
          attemptedUsername: event.attemptedUsername ?? null,
          reason: event.reason ?? null,
          ipAddress: event.ipAddress ?? null,
          userAgent: event.userAgent ?? null,
        },
      });
    } catch (error) {
      logger.error(
        { err: error instanceof Error ? error.message : "unknown", event: event.event },
        "auth audit write failed",
      );
    }
  }
}
