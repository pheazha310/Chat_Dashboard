import type { AgentProfile, CustomerProfile, Directory } from "@shared/ports/directory.js";

interface Entry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Short-lived cache in front of Backend 1: agent names are needed on every inbox page and realtime event, and they
 * change rarely. Customers are not cached (sensitive data should not linger in this process).
 */
export class CachedDirectory implements Directory {
  private readonly agents = new Map<string, Entry<AgentProfile | null>>();

  constructor(
    private readonly inner: Directory,
    private readonly ttlMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  get source() {
    return this.inner.source;
  }

  getCustomer(customerId: string): Promise<CustomerProfile | null> {
    return this.inner.getCustomer(customerId);
  }

  async getAgents(agentIds: string[]): Promise<AgentProfile[]> {
    const wanted = [...new Set(agentIds.map(String))];
    const missing = wanted.filter((id) => {
      const hit = this.agents.get(id);
      return !hit || hit.expiresAt <= this.now();
    });
    if (missing.length > 0) {
      const found = new Map((await this.inner.getAgents(missing)).map((agent) => [agent.id, agent]));
      for (const id of missing) {
        this.agents.set(id, { value: found.get(id) ?? null, expiresAt: this.now() + this.ttlMs });
      }
    }
    return wanted.flatMap((id) => this.agents.get(id)?.value ?? []);
  }
}
