import { logger } from "@config/logger.js";

/** For side effects after a commit (notifications, system messages): a failure is logged, never propagated. */
export async function bestEffort(what: string, task: () => Promise<unknown>): Promise<void> {
  try {
    await task();
  } catch (error) {
    logger.warn({ err: error }, `${what} failed`);
  }
}
