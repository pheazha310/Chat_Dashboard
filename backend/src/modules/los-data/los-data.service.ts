import { logger } from "@config/logger.js";
import type { AuthContext } from "@shared/auth/auth.types.js";
import type { ConversationAccess } from "@shared/ports/conversation-access.js";
import type { LosApplicationSummary } from "./los-data.client.js";
import type { LoanApplicationRepository } from "./los-data.repository.js";
import type { LoanApplicationDto } from "./los-data.types.js";

/** Reads a customer's latest application from LOS with their own token; null while LOS data is not configured. */
export type LosReaderFor = (
  customerToken: string,
) => { getLatestApplication(): Promise<LosApplicationSummary | null> } | null;

/**
 * Loan data for the agent panel, without any service credential from LOS: when a customer signs in with their LOS token,
 * their own latest application is read once with that token and six fields are kept (the token is not). Staff then read
 * the snapshot through a conversation they may open. It is as fresh as the customer's last sign-in.
 */
export class LoanApplicationService {
  constructor(
    private readonly repository: LoanApplicationRepository,
    private readonly access: ConversationAccess,
    private readonly losFor: LosReaderFor,
  ) {}

  /** Never throws: a LOS failure must not stop the customer from signing in. */
  async refreshFromCustomerToken(customerId: string, customerToken: string): Promise<void> {
    try {
      const reader = this.losFor(customerToken);
      if (!reader) return;
      const application = await reader.getLatestApplication();
      if (application) await this.repository.upsert(customerId, application);
    } catch (error) {
      // Only the error is logged, never the token or the application.
      logger.warn(
        { err: error instanceof Error ? error.message : "unknown" },
        "could not read the customer's LOS application",
      );
    }
  }

  /**
   * The snapshot of the application behind a conversation the caller can open, or null (no application, not read yet,
   * or it belongs to someone other than the conversation's customer).
   */
  async forConversation(auth: AuthContext, conversationId: string): Promise<LoanApplicationDto | null> {
    const conversation = await this.access.requireVisible(auth, conversationId);
    if (conversation.applicationId === null || conversation.customerId === null) return null;
    const row = await this.repository.find(conversation.applicationId);
    if (!row || row.customerId !== conversation.customerId) return null;
    return {
      applicationId: row.applicationId,
      status: row.status,
      ticketNumber: row.ticketNumber,
      appliedDate: row.appliedDate,
      loanPurpose: row.loanPurpose,
      requestedLoanSize: row.requestedLoanSize,
      requestedLoanTerm: row.requestedLoanTerm,
      fetchedAt: row.fetchedAt.toISOString(),
    };
  }
}
