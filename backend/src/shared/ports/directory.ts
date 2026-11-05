/**
 * People and loan data owned by Backend 1. This backend never stores it (only ids); it asks through this port.
 * The real contract is not known yet, so only this interface is fixed (see AGENTS.md).
 */
export interface AgentProfile {
  id: string;
  name: string;
  avatarUrl: string | null;
}

/**
 * Everything Backend 1 knows about a customer, unfiltered: the port returns the full profile, and what a given agent
 * may see is decided here (see `redactCustomer`), because Backend 1's permission model is not known yet.
 */
export interface CustomerProfile {
  id: string;
  name: string;
  avatarUrl: string | null;
  blacklisted: boolean | null;
  email: string | null;
  phone: string | null;
  nationalId: string | null;
  occupation: string | null;
  salary: string | null;
}

export interface Directory {
  /** `null` when Backend 1 has no such customer. Throws when Backend 1 cannot be reached. */
  getCustomer(customerId: bigint): Promise<CustomerProfile | null>;
  /** Profiles for the ids Backend 1 knows; unknown ids are simply absent. */
  getAgents(agentIds: bigint[]): Promise<AgentProfile[]>;
  /** Short label for logs and responses: where the data came from. */
  readonly source: string;
}
