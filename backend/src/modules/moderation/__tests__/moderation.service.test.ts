import { fromPartial } from "@total-typescript/shoehorn";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeRealtime } from "../../../__tests__/support/realtime.js";
import { uid } from "../../../__tests__/support/ids.js";
import type { AuthContext } from "@shared/auth/auth.types.js";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "@shared/errors/AppError.js";
import type { ModerationRepository } from "../moderation.repository.js";
import { ModerationService } from "../moderation.service.js";

vi.mock("@config/logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

const repo = {
  inTransaction: vi.fn(),
  isBlocked: vi.fn(),
  findActiveBlock: vi.fn(),
  block: vi.fn(),
  unblock: vi.fn(),
  listBlocks: vi.fn(),
  activeKeywords: vi.fn(),
  countActiveKeywords: vi.fn(),
  findKeyword: vi.fn(),
  findKeywordByText: vi.fn(),
  createKeyword: vi.fn(),
  updateKeyword: vi.fn(),
  deleteKeyword: vi.fn(),
  listKeywords: vi.fn(),
  openReport: vi.fn(),
  findReport: vi.fn(),
  review: vi.fn(),
  listReports: vi.fn(),
  record: vi.fn(),
  addConversationActivity: vi.fn(),
};
const conversations = { requireVisible: vi.fn(), requireForCustomer: vi.fn() };
const messages = { existsInConversation: vi.fn() };
const directory = { getCustomer: vi.fn(), getAgents: vi.fn(), source: "test" };
const realtime = fakeRealtime();
let now = 1_000_000;
let service: ModerationService;

const owner: AuthContext = { userId: uid(1), role: "AGENT" };
const other: AuthContext = { userId: uid(2), role: "AGENT" };
const supervisor: AuthContext = { userId: uid(9), role: "SUPERVISOR" };
const customerId = uid(100);
const state = (patch = {}) => ({
  id: uid(10),
  customerId,
  status: "OPEN",
  handoffStatus: "ASSIGNED",
  assignedAgentId: uid(1),
  isArchived: false,
  ...patch,
});
const at = new Date("2030-01-01T00:00:00Z");
const blockRow = (patch = {}) => ({
  id: uid(60),
  customerId,
  blockedBy: uid(1),
  reason: null,
  blockedAt: at,
  unblockedAt: null,
  unblockedBy: null,
  ...patch,
});
const reportRow = (patch = {}) => ({
  id: uid(70),
  conversationId: uid(10),
  reportedByType: "AGENT",
  reportedById: uid(1),
  messageId: null,
  reason: "spam",
  status: "PENDING",
  reviewedBy: null,
  reviewedAt: null,
  resolutionNote: null,
  createdAt: at,
  ...patch,
});

beforeEach(() => {
  vi.resetAllMocks();
  now = 1_000_000;
  service = new ModerationService(
    fromPartial<ModerationRepository>(repo),
    () => conversations,
    () => messages,
    directory,
    realtime,
    () => now,
  );
  for (const mock of Object.values(realtime)) mock.mockResolvedValue(undefined);
  repo.inTransaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(repo));
  repo.record.mockResolvedValue({});
  repo.addConversationActivity.mockResolvedValue(undefined);
  repo.countActiveKeywords.mockResolvedValue(0);
  repo.findKeywordByText.mockResolvedValue(null);
  conversations.requireVisible.mockResolvedValue(state());
  conversations.requireForCustomer.mockResolvedValue(state());
  messages.existsInConversation.mockResolvedValue(true);
  directory.getCustomer.mockResolvedValue({ name: "Maya Chen" });
});

describe("blocking", () => {
  it("lets the owner or a supervisor block the conversation's customer, and logs it", async () => {
    repo.block.mockResolvedValue(blockRow());
    const result = await service.blockFromConversation(owner, uid(10), { reason: "abusive" });

    expect(repo.block).toHaveBeenCalledWith(customerId, uid(1), "abusive");
    expect(result).toMatchObject({ customerName: "Maya Chen", permissions: { canUnblock: true } });
    expect(repo.record).toHaveBeenCalledWith(uid(1), "BLOCK_CUSTOMER", "CUSTOMER", customerId, {
      reason: "abusive",
      conversationId: uid(10),
    });
    expect(realtime.messageEvent).toHaveBeenCalledWith(uid(10), "customer.blocked", expect.anything());
    await expect(service.blockFromConversation(supervisor, uid(10), {})).resolves.toBeDefined();
  });

  it("refuses other agents, reports an existing block as a conflict, and a missing customer", async () => {
    await expect(service.blockFromConversation(other, uid(10), {})).rejects.toBeInstanceOf(ForbiddenError);
    repo.block.mockResolvedValue(null);
    await expect(service.blockFromConversation(owner, uid(10), {})).rejects.toBeInstanceOf(ConflictError);
    expect(repo.record).not.toHaveBeenCalled();
    conversations.requireVisible.mockResolvedValue(state({ customerId: null }));
    await expect(service.blockFromConversation(owner, uid(10), {})).rejects.toBeInstanceOf(ConflictError);
  });

  it("lets only supervisors block by id", async () => {
    await expect(service.blockCustomer(owner, customerId, {})).rejects.toBeInstanceOf(ForbiddenError);
    repo.block.mockResolvedValue(blockRow());
    await expect(service.blockCustomer(supervisor, customerId, {})).resolves.toBeDefined();
    expect(realtime.messageEvent).not.toHaveBeenCalled(); // no conversation to tell
  });

  it("still returns the block when the customer's name cannot be fetched", async () => {
    repo.block.mockResolvedValue(blockRow());
    directory.getCustomer.mockRejectedValue(new Error("Backend 1 down"));
    await expect(service.blockCustomer(supervisor, customerId, {})).resolves.toMatchObject({ customerName: null });
  });

  it("lifts a block for a supervisor or whoever made it, and shows nothing to anyone else", async () => {
    repo.findActiveBlock.mockResolvedValue(blockRow());
    repo.unblock.mockResolvedValue(blockRow({ unblockedAt: at, unblockedBy: uid(1) }));
    await expect(service.unblock(owner, customerId)).resolves.toMatchObject({ permissions: { canUnblock: false } });
    await expect(service.unblock(supervisor, customerId)).resolves.toBeDefined();
    await expect(service.unblock(other, customerId)).rejects.toBeInstanceOf(NotFoundError);

    repo.findActiveBlock.mockResolvedValue(null);
    await expect(service.unblock(supervisor, customerId)).rejects.toBeInstanceOf(NotFoundError);
    repo.findActiveBlock.mockResolvedValue(blockRow());
    repo.unblock.mockResolvedValue(null); // lifted by someone else in between
    await expect(service.unblock(supervisor, customerId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("lists every block for a supervisor and only their own for an agent", async () => {
    repo.listBlocks.mockResolvedValue({ items: [blockRow()], total: 1 });
    await service.listBlocks(supervisor, { page: 1, size: 25, active: true });
    expect(repo.listBlocks).toHaveBeenLastCalledWith(true, undefined, 0, 25);
    await service.listBlocks(owner, { page: 2, size: 10, active: false });
    expect(repo.listBlocks).toHaveBeenLastCalledWith(false, uid(1), 10, 10);
  });
});

describe("keywords", () => {
  it("matches active keywords ignoring case and remembers the list for a short while", async () => {
    repo.activeKeywords.mockResolvedValue([
      { id: uid(81), keyword: "Free Money" },
      { id: uid(82), keyword: "wire transfer" },
    ]);
    expect(await service.matchedKeywords("Get FREE MONEY now")).toEqual([uid(81)]);
    expect(await service.matchedKeywords("a Wire Transfer, and free money")).toEqual([uid(81), uid(82)]);
    expect(await service.matchedKeywords("hello")).toEqual([]);
    expect(repo.activeKeywords).toHaveBeenCalledTimes(1);

    now += 16_000;
    await service.matchedKeywords("hello");
    expect(repo.activeKeywords).toHaveBeenCalledTimes(2);
  });

  it("uses a changed list at once on this instance", async () => {
    repo.activeKeywords.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: uid(81), keyword: "scam" }]);
    expect(await service.matchedKeywords("a scam")).toEqual([]);
    repo.createKeyword.mockResolvedValue({
      id: uid(81),
      keyword: "scam",
      isActive: true,
      createdBy: uid(9),
      createdAt: at,
    });
    await service.createKeyword(supervisor, "scam");
    expect(await service.matchedKeywords("a scam")).toEqual([uid(81)]);
  });

  it("lets only supervisors change keywords and refuses duplicates and too many", async () => {
    await expect(service.createKeyword(owner, "x")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.updateKeyword(owner, uid(81), { isActive: false })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.deleteKeyword(owner, uid(81))).rejects.toBeInstanceOf(ForbiddenError);

    repo.findKeywordByText.mockResolvedValue({ id: uid(81) });
    await expect(service.createKeyword(supervisor, "Scam")).rejects.toBeInstanceOf(ConflictError);
    repo.findKeywordByText.mockResolvedValue(null);
    repo.countActiveKeywords.mockResolvedValue(1000);
    await expect(service.createKeyword(supervisor, "new")).rejects.toBeInstanceOf(ConflictError);
    expect(repo.createKeyword).not.toHaveBeenCalled();
  });

  it("allows renaming to its own text but not to another keyword's, and 404s unknown ids", async () => {
    repo.findKeyword.mockResolvedValue({ id: uid(81), keyword: "old", isActive: true });
    repo.updateKeyword.mockResolvedValue({
      id: uid(81),
      keyword: "OLD",
      isActive: true,
      createdBy: null,
      createdAt: at,
    });
    repo.findKeywordByText.mockResolvedValue({ id: uid(81) });
    await expect(service.updateKeyword(supervisor, uid(81), { keyword: "OLD" })).resolves.toBeDefined();
    repo.findKeywordByText.mockResolvedValue({ id: uid(82) });
    await expect(service.updateKeyword(supervisor, uid(81), { keyword: "taken" })).rejects.toBeInstanceOf(
      ConflictError,
    );
    repo.findKeyword.mockResolvedValue(null);
    await expect(service.updateKeyword(supervisor, uid(99), { isActive: false })).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.deleteKeyword(supervisor, uid(99))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("keeps the removed keyword's text in the log", async () => {
    repo.findKeyword.mockResolvedValue({ id: uid(81), keyword: "scam", isActive: true });
    repo.deleteKeyword.mockResolvedValue(true);
    await service.deleteKeyword(supervisor, uid(81));
    expect(repo.record).toHaveBeenCalledWith(uid(9), "REMOVE_KEYWORD", "KEYWORD", uid(81), { keyword: "scam" });
  });
});

describe("spam reports", () => {
  it("lets anyone who can see the conversation report it, checking the message belongs to it", async () => {
    repo.openReport.mockResolvedValue(reportRow({ messageId: uid(5) }));
    const result = await service.report(other, uid(10), { reason: "spam", messageId: uid(5) });
    expect(result).toMatchObject({ status: "PENDING", reportedBy: { type: "AGENT", id: uid(1) }, messageId: uid(5) });
    expect(repo.openReport).toHaveBeenCalledWith(expect.objectContaining({ reportedById: uid(2), messageId: uid(5) }));
    expect(realtime.messageEvent).toHaveBeenCalledWith(uid(10), "spam.reported", expect.anything());

    messages.existsInConversation.mockResolvedValue(false);
    await expect(service.report(owner, uid(10), { reason: "spam", messageId: uid(6) })).rejects.toBeInstanceOf(
      BadRequestError,
    );
  });

  it("answers 404 for a conversation the reporter cannot see and 409 for a repeated report", async () => {
    conversations.requireVisible.mockRejectedValueOnce(new NotFoundError("hidden"));
    await expect(service.report(other, uid(10), { reason: "spam" })).rejects.toBeInstanceOf(NotFoundError);
    repo.openReport.mockResolvedValue(null);
    await expect(service.report(owner, uid(10), { reason: "spam" })).rejects.toBeInstanceOf(ConflictError);
    expect(repo.record).not.toHaveBeenCalled();
  });

  it("takes a customer's report without an audit entry (a customer is not an agent)", async () => {
    repo.openReport.mockResolvedValue(reportRow({ reportedByType: "CUSTOMER", reportedById: customerId }));
    await expect(service.reportByCustomer(customerId, uid(10), { reason: "rude agent" })).resolves.toMatchObject({
      reportedBy: { type: "CUSTOMER" },
    });
    expect(repo.record).not.toHaveBeenCalled();
    conversations.requireForCustomer.mockRejectedValue(new NotFoundError("not theirs"));
    await expect(service.reportByCustomer(uid(555), uid(10), { reason: "x" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("lets only supervisors review, once, and can block the customer in the same step", async () => {
    await expect(service.review(owner, uid(70), { status: "CONFIRMED" })).rejects.toBeInstanceOf(ForbiddenError);
    repo.findReport.mockResolvedValue(reportRow());
    repo.review.mockResolvedValue(reportRow({ status: "CONFIRMED", reviewedBy: uid(9) }));
    repo.block.mockResolvedValue(blockRow());

    const result = await service.review(supervisor, uid(70), { status: "CONFIRMED", blockCustomer: true });
    expect(result.status).toBe("CONFIRMED");
    expect(repo.block).toHaveBeenCalledWith(customerId, uid(9), expect.stringContaining(uid(70)));
    expect(repo.record).toHaveBeenCalledWith(uid(9), "CONFIRM_SPAM", "SPAM_REPORT", uid(70), { blockedCustomer: true });
    expect(realtime.messageEvent).toHaveBeenCalledWith(uid(10), "customer.blocked", expect.anything());
    expect(realtime.messageEvent).toHaveBeenCalledWith(uid(10), "spam.reviewed", expect.anything());

    repo.review.mockResolvedValue(null);
    await expect(service.review(supervisor, uid(70), { status: "DISMISSED" })).rejects.toBeInstanceOf(ConflictError);
    repo.findReport.mockResolvedValue(null);
    await expect(service.review(supervisor, uid(71), { status: "DISMISSED" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses blockCustomer on a dismissal, and does not log a block that already existed", async () => {
    repo.findReport.mockResolvedValue(reportRow());
    await expect(
      service.review(supervisor, uid(70), { status: "DISMISSED", blockCustomer: true }),
    ).rejects.toBeInstanceOf(BadRequestError);

    repo.review.mockResolvedValue(reportRow({ status: "CONFIRMED" }));
    repo.block.mockResolvedValue(null); // already blocked
    await service.review(supervisor, uid(70), { status: "CONFIRMED", blockCustomer: true });
    expect(repo.record).not.toHaveBeenCalledWith(
      uid(9),
      "BLOCK_CUSTOMER",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    expect(realtime.messageEvent).not.toHaveBeenCalledWith(uid(10), "customer.blocked", expect.anything());
  });

  it("shows a supervisor every report and an agent only their own; the log is for supervisors", async () => {
    repo.listReports.mockResolvedValue({ items: [], total: 0 });
    await service.listReports(supervisor, { page: 1, size: 25, status: "PENDING" });
    expect(repo.listReports).toHaveBeenLastCalledWith({ status: "PENDING", reportedById: undefined }, 0, 25);
    await service.listReports(owner, { page: 1, size: 25 });
    expect(repo.listReports).toHaveBeenLastCalledWith({ status: undefined, reportedById: uid(1) }, 0, 25);
    await expect(service.listActivities(owner, { page: 1, size: 25 })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
