import { beforeEach, describe, expect, it, vi } from "vitest";

const rest = vi.hoisted(() => ({
  blockCustomerById: vi.fn(),
  createKeywordRequest: vi.fn(),
  deleteKeywordRequest: vi.fn(),
  listBlocks: vi.fn(),
  listKeywords: vi.fn(),
  unblockCustomer: vi.fn(),
}));
const notify = vi.hoisted(() => vi.fn());
vi.mock("@/shared/api/rest", () => rest);
vi.mock("@/shared/ui", () => ({ notify }));

import {
  addKeyword,
  blockById,
  loadModeration,
  removeKeyword,
  unblock,
  useModerationStore as store,
} from "./moderation";

const block = (customerId: string) => ({
  id: `b-${customerId}`,
  customerId,
  customerName: null,
  blockedBy: "me",
  reason: null,
  blockedAt: "2030-01-01T00:00:00.000Z",
  unblockedAt: null,
  permissions: { canUnblock: true },
});
const keyword = (id: string, text: string) => ({
  id,
  keyword: text,
  isActive: true,
  createdAt: "2030-01-01T00:00:00.000Z",
});

beforeEach(() => {
  vi.resetAllMocks();
  store.setState({ blocks: [], keywords: [], status: "idle" });
});

describe("moderation lists", () => {
  it("loads blocks and keywords together, and reports a failed load", async () => {
    rest.listBlocks.mockResolvedValue([block("c1")]);
    rest.listKeywords.mockResolvedValue([keyword("k1", "scam")]);
    await loadModeration();
    expect(store.getState()).toMatchObject({
      status: "ready",
      blocks: [{ customerId: "c1" }],
      keywords: [{ keyword: "scam" }],
    });

    rest.listKeywords.mockRejectedValue(new Error("500"));
    await loadModeration();
    expect(store.getState().status).toBe("error");
  });

  it("adds a block at the top and a keyword in alphabetical order, from the server's answer", async () => {
    store.setState({ blocks: [block("old")], keywords: [keyword("k2", "zebra")] });
    rest.blockCustomerById.mockResolvedValue(block("new"));
    rest.createKeywordRequest.mockResolvedValue(keyword("k1", "alpha"));

    expect(await blockById(" new ")).toBe(true);
    expect(rest.blockCustomerById).toHaveBeenCalledWith("new");
    expect(store.getState().blocks.map((b) => b.customerId)).toEqual(["new", "old"]);
    expect(await addKeyword(" alpha ")).toBe(true);
    expect(rest.createKeywordRequest).toHaveBeenCalledWith("alpha");
    expect(store.getState().keywords.map((k) => k.keyword)).toEqual(["alpha", "zebra"]);
  });

  it("says why a request was refused and changes nothing", async () => {
    rest.blockCustomerById.mockRejectedValue(new Error("This customer is already blocked"));
    rest.createKeywordRequest.mockRejectedValue(new Error("This keyword already exists"));
    expect(await blockById("c1")).toBe(false);
    expect(await addKeyword("scam")).toBe(false);
    expect(notify).toHaveBeenCalledWith("This customer is already blocked");
    expect(notify).toHaveBeenCalledWith("This keyword already exists");
    expect(store.getState().blocks).toEqual([]);
    expect(store.getState().keywords).toEqual([]);
  });

  it("removes an entry once the server confirms, and reloads when it refuses", async () => {
    store.setState({ blocks: [block("c1"), block("c2")], keywords: [keyword("k1", "scam")] });
    rest.unblockCustomer.mockResolvedValue({});
    rest.deleteKeywordRequest.mockResolvedValue({});
    await unblock("c1");
    await removeKeyword("k1");
    expect(store.getState().blocks.map((b) => b.customerId)).toEqual(["c2"]);
    expect(store.getState().keywords).toEqual([]);

    rest.unblockCustomer.mockRejectedValue(new Error("This customer is not blocked"));
    rest.listBlocks.mockResolvedValue([]);
    rest.listKeywords.mockResolvedValue([]);
    await unblock("c2");
    expect(notify).toHaveBeenCalledWith("This customer is not blocked");
    await vi.waitFor(() => expect(store.getState().blocks).toEqual([]));
  });
});
