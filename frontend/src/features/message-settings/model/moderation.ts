import { create } from "zustand";
import {
  blockCustomerById,
  createKeywordRequest,
  deleteKeywordRequest,
  listBlocks,
  listKeywords,
  unblockCustomer,
  type BlockedKeyword,
  type CustomerBlock,
} from "@/shared/api/rest";
import { notify } from "@/shared/ui";

type ModerationState = {
  blocks: CustomerBlock[];
  keywords: BlockedKeyword[];
  status: "idle" | "loading" | "ready" | "error";
};

/** The team-wide blocked customers and keywords, read from the backend (docs/api-moderation.md). */
export const useModerationStore = create<ModerationState>(() => ({ blocks: [], keywords: [], status: "idle" }));

const failure = (error: unknown, fallback: string) => notify(error instanceof Error ? error.message : fallback);

export async function loadModeration() {
  useModerationStore.setState({ status: "loading" });
  try {
    const [blocks, keywords] = await Promise.all([listBlocks(), listKeywords()]);
    useModerationStore.setState({ blocks, keywords, status: "ready" });
  } catch {
    useModerationStore.setState({ status: "error" });
  }
}

export async function blockById(customerId: string) {
  try {
    const block = await blockCustomerById(customerId.trim());
    useModerationStore.setState((state) => ({ blocks: [block, ...state.blocks] }));
    return true;
  } catch (error) {
    failure(error, "Could not block the customer");
    return false;
  }
}

export async function unblock(customerId: string) {
  try {
    await unblockCustomer(customerId);
    useModerationStore.setState((state) => ({
      blocks: state.blocks.filter((block) => block.customerId !== customerId),
    }));
  } catch (error) {
    failure(error, "Could not unblock the customer");
    void loadModeration();
  }
}

export async function addKeyword(keyword: string) {
  try {
    const created = await createKeywordRequest(keyword.trim());
    useModerationStore.setState((state) => ({
      keywords: [...state.keywords, created].sort((a, b) => a.keyword.localeCompare(b.keyword)),
    }));
    return true;
  } catch (error) {
    failure(error, "Could not add the keyword");
    return false;
  }
}

export async function removeKeyword(keywordId: string) {
  try {
    await deleteKeywordRequest(keywordId);
    useModerationStore.setState((state) => ({ keywords: state.keywords.filter((item) => item.id !== keywordId) }));
  } catch (error) {
    failure(error, "Could not remove the keyword");
    void loadModeration();
  }
}
