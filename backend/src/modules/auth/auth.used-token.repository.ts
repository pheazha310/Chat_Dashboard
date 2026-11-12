import { prisma } from "@config/database.js";
import type { UsedTokenIds } from "./auth.los.js";

/**
 * The used LOS hand-off token ids in PostgreSQL: the primary key makes `claim` atomic across API instances and
 * restarts. Expired rows (the token could not be used any more) are deleted on the way.
 */
export class PrismaUsedTokenIds implements UsedTokenIds {
  constructor(private readonly db = prisma) {}

  async claim(id: string, ttlMs: number): Promise<boolean> {
    const now = new Date();
    await this.db.losHandoffToken.deleteMany({ where: { expiresAt: { lte: now } } });
    const expiresAt = new Date(now.getTime() + Math.max(1, Math.ceil(ttlMs)));
    const inserted = await this.db.$executeRaw`
      INSERT INTO los_handoff_tokens (jti, expires_at) VALUES (${id}, ${expiresAt}) ON CONFLICT (jti) DO NOTHING`;
    return inserted === 1;
  }
}
