import type { AgentProfile } from "@shared/ports/directory.js";

export interface AgentMeDto {
  /** Backend 1 id (what every other endpoint calls `agentId`). */
  userId: string;
  /** This backend's own id for the user (`chat_users.id`). */
  chatUserId: string | null;
  role: string;
  /** Name and avatar from Backend 1; null when Backend 1 could not be reached. */
  profile: AgentProfile | null;
  /** Their chosen status while online, otherwise OFFLINE. Change it with `PUT /presence/me`. */
  availability: string;
}

/** The customer's own profile. Only what the customer may see about themselves: no national id, salary or flags. */
export interface CustomerMeDto {
  userId: string;
  chatUserId: string | null;
  name: string;
  avatarUrl: string | null;
  email: string | null;
  phone: string | null;
}
