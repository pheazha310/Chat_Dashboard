import { logger } from "@config/logger.js";
import { NotFoundError, ServiceUnavailableError } from "@shared/errors/AppError.js";
import type { AuthContext } from "@shared/auth/auth.types.js";
import { can } from "@shared/auth/permissions.js";
import type { AccessibleConversationState, ConversationAccess } from "@shared/ports/conversation-access.js";
import type { CustomerProfile, Directory } from "@shared/ports/directory.js";
import { isOwner } from "@shared/policy/conversation-access.js";
import { idToString } from "@shared/utils/ids.js";
import type { PageQuery } from "@shared/utils/pagination.js";
import type { CustomerRepository } from "./customer.repository.js";
import type { ConversationLister, CustomerDto, ParticipantDto } from "./customer.types.js";

/**
 * PROVISIONAL sensitive-data policy (Backend 1's permission model is unknown; replace when it is provided):
 * - basic (name, avatar, blacklisted): anyone who can open the conversation;
 * - contact (email, phone): the conversation's owner and supervisors;
 * - sensitive (national id, occupation, salary): supervisors only.
 */
const CONTACT = ["email", "phone"] as const;
const SENSITIVE = ["nationalId", "occupation", "salary"] as const;

export function redactCustomer(
  profile: CustomerProfile,
  auth: AuthContext,
  conversation: Pick<AccessibleConversationState, "assignedAgentId">,
  source: string,
): CustomerDto {
  const canSeeContact = can(auth, "customers.view_contact") || isOwner(auth, conversation);
  const canSeeSensitive = can(auth, "customers.view_sensitive");
  const restricted: string[] = [];
  const dto: CustomerDto = { ...profile, restricted, source };
  for (const field of CONTACT) {
    if (!canSeeContact) ((dto[field] = null), restricted.push(field));
  }
  for (const field of SENSITIVE) {
    if (!canSeeSensitive) ((dto[field] = null), restricted.push(field));
  }
  return dto;
}

export class CustomerService {
  constructor(
    private readonly repository: CustomerRepository,
    private readonly directory: Directory,
    private readonly access: ConversationAccess,
    private readonly conversations: ConversationLister,
  ) {}

  /** The customer behind a conversation the caller can open, filtered to what the caller may see. */
  async customer(auth: AuthContext, conversationId: string): Promise<CustomerDto> {
    const conversation = await this.access.requireVisible(auth, conversationId);
    if (conversation.customerId === null) throw new NotFoundError("This conversation has no customer");
    let profile: CustomerProfile | null;
    try {
      profile = await this.directory.getCustomer(conversation.customerId);
    } catch (error) {
      logger.warn({ err: error }, "customer lookup failed");
      throw new ServiceUnavailableError("Customer information is temporarily unavailable");
    }
    if (!profile) throw new NotFoundError("Customer not found");
    return redactCustomer(profile, auth, conversation, this.directory.source);
  }

  /**
   * The customer's other conversations that the caller is allowed to see (hidden ones are not counted), newest
   * first. Anchored to a conversation the caller can open, so customers cannot be enumerated by id.
   */
  async otherConversations(auth: AuthContext, conversationId: string, page: PageQuery) {
    const conversation = await this.access.requireVisible(auth, conversationId);
    if (conversation.customerId === null) throw new NotFoundError("This conversation has no customer");
    return this.conversations.list(auth, {
      ...page,
      filter: "all",
      customerId: conversation.customerId,
      excludeId: conversationId,
    });
  }

  async participants(auth: AuthContext, conversationId: string): Promise<ParticipantDto[]> {
    const conversation = await this.access.requireVisible(auth, conversationId);
    const rows = await this.repository.participants(conversationId);

    const agentIds = rows
      .filter((r) => r.participantType === "AGENT" && r.participantId !== null)
      .map((r) => r.participantId!);
    const agents = new Map<string, { name: string; avatarUrl: string | null }>();
    let customer: CustomerProfile | null = null;
    try {
      for (const agent of await this.directory.getAgents(agentIds)) agents.set(agent.id, agent);
      if (conversation.customerId !== null) customer = await this.directory.getCustomer(conversation.customerId);
    } catch (error) {
      logger.warn({ err: error }, "participant profiles unavailable");
    }

    return rows.map((row) => {
      const participantId = row.participantId === null ? null : idToString(row.participantId);
      const profile =
        row.participantType === "AGENT" && participantId
          ? (agents.get(participantId) ?? null)
          : row.participantType === "CUSTOMER" && customer
            ? { name: customer.name, avatarUrl: customer.avatarUrl }
            : null;
      return {
        participantType: row.participantType,
        participantId,
        role: row.participantRole,
        joinedAt: row.joinedAt.toISOString(),
        leftAt: row.leftAt?.toISOString() ?? null,
        profile: profile ? { name: profile.name, avatarUrl: profile.avatarUrl } : null,
      };
    });
  }
}
