/** Agents who are online and AVAILABLE, for "a conversation needs attention" notifications. */
export interface AvailableAgents {
  availableAgentIds(): Promise<bigint[]>;
}
