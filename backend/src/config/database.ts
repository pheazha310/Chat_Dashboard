import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../../prisma/generated/prisma/client.js";
import { env } from "./env.js";

// Prisma 7 needs a driver adapter; @prisma/adapter-pg talks to PostgreSQL via `pg`.
// Sessions are pinned to UTC: the adapter reads timestamptz values as UTC, so a server or role timezone such as
// Asia/Phnom_Penh would shift every database-generated timestamp (now(), column defaults) by the UTC offset.
const adapter = new PrismaPg({ connectionString: env.DATABASE_URL, options: "-c TimeZone=UTC" });

export const prisma = new PrismaClient({ adapter });

/** Either the root client or a client bound to an open transaction. Repositories take this in their constructor. */
export type Db = PrismaClient | Prisma.TransactionClient;

/** Runs `fn` in a transaction, or directly when `db` already is one (nested calls join the outer transaction). */
export function runInTransaction<T>(db: Db, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return "$transaction" in db ? db.$transaction(fn) : fn(db);
}
