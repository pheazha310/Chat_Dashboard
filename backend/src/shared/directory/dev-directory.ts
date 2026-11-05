import type { AgentProfile, CustomerProfile, Directory } from "@shared/ports/directory.js";

/**
 * DEVELOPMENT/TEST ONLY stand-in for Backend 1. Every id "exists" and gets a synthetic profile, clearly labelled
 * (`source: "dev-stub"` in API responses). env.ts refuses BACKEND1_MODE=dev in production.
 */
export class DevDirectory implements Directory {
  readonly source = "dev-stub";

  async getCustomer(customerId: string): Promise<CustomerProfile> {
    return {
      id: customerId.toString(),
      name: `Customer ${customerId}`,
      avatarUrl: null,
      blacklisted: false,
      email: `customer-${customerId}@example.test`,
      phone: `+000 000 ${customerId}`,
      nationalId: `DEV-${customerId}`,
      occupation: "Placeholder occupation",
      salary: "0",
    };
  }

  async getAgents(agentIds: string[]): Promise<AgentProfile[]> {
    return agentIds.map((id) => ({ id: id.toString(), name: `Agent ${id}`, avatarUrl: null }));
  }
}
