import type { Redis } from "ioredis";
import { prisma, runInTransaction, type Db } from "@config/database.js";
import type { SelectableStatus } from "./presence.types.js";

const SOCKET_TTL_SECONDS = 120;
const ONLINE_SET = "presence:online";
const chosenKey = (userId: string) => `presence:status:${userId}`;
const socketsKey = (userId: string) => `presence:sockets:${userId}`;

/**
 * Live presence is in Redis (shared by all API instances); Postgres keeps the history of status periods.
 * An agent is online while their set of open sockets is non-empty. The set expires unless an instance keeps
 * refreshing it (heartbeat), so sockets of a crashed instance eventually stop counting.
 */
export class PresenceRepository {
  constructor(
    private readonly redis: Redis,
    private readonly db: Db = prisma,
  ) {}

  /** Adds a socket; returns how many sockets the user now has. */
  async addSocket(userId: string, connectionId: string): Promise<number> {
    const key = socketsKey(userId);
    await this.redis.sadd(key, connectionId);
    await this.redis.expire(key, SOCKET_TTL_SECONDS);
    return this.redis.scard(key);
  }

  async refreshSocket(userId: string, connectionId: string): Promise<void> {
    const key = socketsKey(userId);
    await this.redis.sadd(key, connectionId);
    await this.redis.expire(key, SOCKET_TTL_SECONDS);
  }

  /** Removes a socket; returns how many remain. */
  async removeSocket(userId: string, connectionId: string): Promise<number> {
    const key = socketsKey(userId);
    await this.redis.srem(key, connectionId);
    return this.redis.scard(key);
  }

  async markOnline(userId: string, online: boolean): Promise<void> {
    if (online) await this.redis.sadd(ONLINE_SET, userId.toString());
    else await this.redis.srem(ONLINE_SET, userId.toString());
  }

  async chosenStatus(userId: string): Promise<SelectableStatus | null> {
    return (await this.redis.get(chosenKey(userId))) as SelectableStatus | null;
  }

  async setChosenStatus(userId: string, status: SelectableStatus): Promise<void> {
    await this.redis.set(chosenKey(userId), status);
  }

  /** Online users with the status they chose. Users whose sockets all expired are dropped. */
  async onlineWithStatus(): Promise<{ userId: string; chosen: SelectableStatus | null }[]> {
    const ids = await this.redis.smembers(ONLINE_SET);
    const entries: { userId: string; chosen: SelectableStatus | null }[] = [];
    for (const id of ids) {
      const userId = id;
      if ((await this.redis.scard(socketsKey(userId))) === 0) {
        await this.redis.srem(ONLINE_SET, id);
        continue;
      }
      entries.push({ userId, chosen: await this.chosenStatus(userId) });
    }
    return entries;
  }

  /** Closes the agent's open status period and opens a new one (one open period per agent is a DB rule). */
  async recordPeriod(agentId: string, status: string): Promise<void> {
    await runInTransaction(this.db, async (tx) => {
      // Two transitions for one agent at once (e.g. set status while a tab closes) would each see no open period and
      // both insert one; the lock makes the second wait and then close the first's period.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${agentId}::text, 0))`;
      const now = new Date();
      await tx.agentPresenceHistory.updateMany({ where: { agentId, endedAt: null }, data: { endedAt: now } });
      await tx.agentPresenceHistory.create({ data: { agentId, status, startedAt: now } });
    });
  }
}
