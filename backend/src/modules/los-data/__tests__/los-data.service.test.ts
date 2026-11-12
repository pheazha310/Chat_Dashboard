import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@shared/auth/auth.types.js";
import { NotFoundError } from "@shared/errors/AppError.js";
import type { ConversationAccess } from "@shared/ports/conversation-access.js";
import { uid } from "../../../__tests__/support/ids.js";
import type { LosApplicationSummary } from "../los-data.client.js";
import type { LoanApplicationRepository } from "../los-data.repository.js";
import { LoanApplicationService } from "../los-data.service.js";

vi.mock("@config/logger.js", () => ({ logger: { warn: vi.fn() } }));

const customerId = uid(100);
const agent: AuthContext = { userId: uid(1), role: "AGENT" };
const summary: LosApplicationSummary = {
  id: 4821,
  status: "SOME_NEW_STATUS",
  ticketNumber: "LN-000123",
  appliedDate: "2026-11-10T14:05:00.000Z",
  loanPurpose: "Business",
  requestedLoanSize: 500,
  requestedLoanTerm: 30,
};

/** An in-memory repository: the snapshots by application id. */
function fakeRepository() {
  /** Shaped like the Prisma row: `applicationId`, not the summary's `id`. */
  type Row = Omit<LosApplicationSummary, "id"> & { applicationId: number; customerId: string; fetchedAt: Date };
  const rows = new Map<number, Row>();
  const repository = {
    upsert: vi.fn(async (customer: string, { id, ...fields }: LosApplicationSummary) => {
      rows.set(id, { ...fields, applicationId: id, customerId: customer, fetchedAt: new Date("2026-11-12T01:00:00Z") });
    }),
    find: vi.fn(async (applicationId: number) => rows.get(applicationId) ?? null),
  };
  return { repository: repository as unknown as LoanApplicationRepository, rows, upsert: repository.upsert };
}

describe("LoanApplicationService", () => {
  let store: ReturnType<typeof fakeRepository>;
  let conversation: { applicationId: number | null; customerId: string | null };
  let latest: ReturnType<typeof vi.fn<() => Promise<LosApplicationSummary | null>>>;
  let service: LoanApplicationService;
  const forToken = vi.fn();

  beforeEach(() => {
    store = fakeRepository();
    conversation = { applicationId: 4821, customerId };
    latest = vi.fn(async () => summary);
    forToken.mockReset().mockImplementation(() => ({ getLatestApplication: latest }));
    const access = {
      requireVisible: vi.fn(async (_auth: AuthContext, id: string) => {
        if (id !== "visible") throw new NotFoundError("hidden");
        return { id, ...conversation };
      }),
    } as unknown as ConversationAccess;
    service = new LoanApplicationService(store.repository, access, forToken);
  });

  describe("refreshFromCustomerToken", () => {
    it("keeps the six fields of the customer's latest application, for that customer", async () => {
      await service.refreshFromCustomerToken(customerId, "los.customer.token");

      expect(forToken).toHaveBeenCalledWith("los.customer.token");
      expect(store.rows.get(4821)).toMatchObject({
        applicationId: 4821,
        status: summary.status,
        loanPurpose: "Business",
        customerId,
      });
    });

    it("stores nothing when the customer has no application", async () => {
      latest.mockResolvedValue(null);
      await service.refreshFromCustomerToken(customerId, "t");
      expect(store.upsert).not.toHaveBeenCalled();
    });

    it("never throws: a LOS failure must not break the customer's sign-in", async () => {
      latest.mockRejectedValue(new Error("LOS down"));
      await expect(service.refreshFromCustomerToken(customerId, "t")).resolves.toBeUndefined();
    });

    it("does nothing while LOS data is not configured", async () => {
      forToken.mockReturnValue(null);
      await expect(service.refreshFromCustomerToken(customerId, "t")).resolves.toBeUndefined();
      expect(store.upsert).not.toHaveBeenCalled();
    });
  });

  describe("forConversation", () => {
    beforeEach(() => service.refreshFromCustomerToken(customerId, "t"));

    it("returns the snapshot of the conversation's application, with when it was read", async () => {
      await expect(service.forConversation(agent, "visible")).resolves.toEqual({
        applicationId: 4821,
        status: "SOME_NEW_STATUS",
        ticketNumber: "LN-000123",
        appliedDate: "2026-11-10T14:05:00.000Z",
        loanPurpose: "Business",
        requestedLoanSize: 500,
        requestedLoanTerm: 30,
        fetchedAt: "2026-11-12T01:00:00.000Z",
      });
    });

    it("does not reveal whether a hidden conversation exists", async () => {
      await expect(service.forConversation(agent, "hidden")).rejects.toBeInstanceOf(NotFoundError);
    });

    it("answers null for a conversation without an application, or one we have not read yet", async () => {
      conversation.applicationId = null;
      await expect(service.forConversation(agent, "visible")).resolves.toBeNull();
      conversation.applicationId = 9999;
      await expect(service.forConversation(agent, "visible")).resolves.toBeNull();
    });

    it("never shows an application that belongs to a different customer than the conversation's", async () => {
      conversation.customerId = uid(200);
      await expect(service.forConversation(agent, "visible")).resolves.toBeNull();
    });
  });
});
