import { logger } from "@config/logger.js";
import { NotFoundError } from "@shared/errors/AppError.js";
import type { AuthContext } from "@shared/auth/auth.types.js";
import type { Directory } from "@shared/ports/directory.js";
import type { ListQuery } from "@modules/conversations/conversation.schema.js";
import type { ConversationService } from "@modules/conversations/conversation.service.js";
import type { PresenceService } from "@modules/presence/presence.service.js";
import type { AgentMeDto, CustomerMeDto } from "./profile.types.js";

/** "Who am I" for the signed-in agent or customer, and their own conversations. Everything is scoped to the token. */
export class ProfileService {
  constructor(
    private readonly directory: Directory,
    private readonly presence: PresenceService,
    private readonly conversations: ConversationService,
  ) {}

  async agentMe(auth: AuthContext): Promise<AgentMeDto> {
    const [profiles, online] = await Promise.all([
      this.directory.getAgents([auth.userId]).catch((error: unknown) => {
        logger.warn({ err: error }, "agent profile unavailable");
        return [];
      }),
      this.presence.snapshot().catch(() => []),
    ]);
    return {
      userId: auth.userId,
      chatUserId: auth.chatUserId ?? null,
      role: auth.role,
      profile: profiles.find((profile) => profile.id === auth.userId) ?? null,
      availability: online.find((entry) => entry.userId === auth.userId)?.status ?? "OFFLINE",
    };
  }

  /** The conversations the agent owns (the inbox's "mine" filter), with the usual inbox filters. */
  agentConversations(auth: AuthContext, query: Omit<ListQuery, "filter">) {
    return this.conversations.list(auth, { ...query, filter: "mine" });
  }

  async customerMe(auth: AuthContext): Promise<CustomerMeDto> {
    const profile = await this.directory.getCustomer(auth.userId);
    if (!profile) throw new NotFoundError("Customer not found");
    return {
      userId: auth.userId,
      chatUserId: auth.chatUserId ?? null,
      name: profile.name,
      avatarUrl: profile.avatarUrl,
      email: profile.email,
      phone: profile.phone,
    };
  }

  customerConversations(auth: AuthContext, query: { page: number; size: number }) {
    return this.conversations.listForCustomer(auth.userId, query);
  }
}
