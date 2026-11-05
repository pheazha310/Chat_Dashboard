import { logger } from "@config/logger.js";
import type { AuthContext } from "@shared/auth/auth.types.js";
import type { AvailableAgents } from "@shared/ports/available-agents.js";
import type { RealtimeNotifier } from "@shared/ports/realtime.js";
import { bestEffort } from "@shared/utils/best-effort.js";
import { idToString } from "@shared/utils/ids.js";
import { withTimeout } from "@shared/utils/with-timeout.js";
import type { PresenceRepository } from "./presence.repository.js";
import type { SetPresenceInput } from "./presence.schema.js";
import type { PresenceDto, PresenceStatus } from "./presence.types.js";

const REDIS_TIMEOUT_MS = 1_500;
const DEFAULT_STATUS = "AVAILABLE";

/**
 * Agent presence. The status an agent picks (AVAILABLE, BUSY, AWAY) is remembered; they count as OFFLINE while they
 * have no open WebSocket. Presence is advisory, so a Redis outage is logged and never blocks a connection.
 */
export class PresenceService implements AvailableAgents {
  constructor(
    private readonly repository: PresenceRepository,
    private readonly realtime: RealtimeNotifier,
  ) {}

  /** A dashboard socket authenticated. Announces the agent when this is their first open session. */
  async connect(auth: AuthContext, connectionId: string) {
    await this.guarded("presence connect", async () => {
      const sockets = await this.repository.addSocket(auth.userId, connectionId);
      if (sockets !== 1) return;
      await this.repository.markOnline(auth.userId, true);
      await this.announce(auth.userId, (await this.repository.chosenStatus(auth.userId)) ?? DEFAULT_STATUS);
    });
  }

  /** A socket closed. Announces OFFLINE when it was the agent's last one. */
  async disconnect(auth: AuthContext, connectionId: string) {
    await this.guarded("presence disconnect", async () => {
      const remaining = await this.repository.removeSocket(auth.userId, connectionId);
      if (remaining > 0) return;
      await this.repository.markOnline(auth.userId, false);
      await this.announce(auth.userId, "OFFLINE");
    });
  }

  /** Keeps the socket counted while its API instance is alive. */
  async heartbeat(auth: AuthContext, connectionId: string) {
    await this.guarded("presence heartbeat", () => this.repository.refreshSocket(auth.userId, connectionId));
  }

  /** The agent picks a status. Shown to everyone immediately if they are online; remembered either way. */
  async setStatus(auth: AuthContext, input: SetPresenceInput): Promise<PresenceDto> {
    await withTimeout(this.repository.setChosenStatus(auth.userId, input.status), REDIS_TIMEOUT_MS, "presence write");
    const online = (await this.snapshot()).some((entry) => entry.userId === idToString(auth.userId));
    if (online) await this.announce(auth.userId, input.status);
    return { userId: idToString(auth.userId), status: online ? input.status : "OFFLINE" };
  }

  /** Every agent who is currently online, with their chosen status. Offline agents are not listed. */
  async snapshot(): Promise<PresenceDto[]> {
    const entries = await withTimeout(this.repository.onlineWithStatus(), REDIS_TIMEOUT_MS, "presence read");
    return entries.map(({ userId, chosen }) => ({ userId: idToString(userId), status: chosen ?? DEFAULT_STATUS }));
  }

  /** Agents who are online and AVAILABLE (not BUSY or AWAY). Empty if presence is unavailable. */
  async availableAgentIds(): Promise<bigint[]> {
    try {
      return (await this.snapshot())
        .filter((entry) => entry.status === "AVAILABLE")
        .map((entry) => BigInt(entry.userId));
    } catch (error) {
      logger.warn({ err: error }, "available agents unavailable");
      return [];
    }
  }

  private async announce(userId: bigint, status: PresenceStatus) {
    await bestEffort("presence history", () => this.repository.recordPeriod(userId, status));
    await bestEffort("realtime", () => this.realtime.presenceChanged(userId, status));
  }

  private async guarded(what: string, task: () => Promise<unknown>) {
    try {
      await withTimeout(task(), REDIS_TIMEOUT_MS, what);
    } catch (error) {
      logger.warn({ err: error }, `${what} failed`);
    }
  }
}
