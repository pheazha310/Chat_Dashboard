import { logger } from "@config/logger.js";
import type { CallbackService } from "./callback.service.js";

/**
 * Runs the callback job (reminders and missed callbacks) on a timer inside the API process. It needs no leader
 * election: every pass claims rows in the database, so several instances and overlapping passes never repeat work.
 * A pass that is still running when the next tick arrives makes that tick skip.
 */
export class CallbackScheduler {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly service: Pick<CallbackService, "processDue">,
    private readonly intervalMs: number,
  ) {}

  start() {
    if (this.timer || this.intervalMs <= 0) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.service.processDue();
      if (result.missed > 0 || result.reminded > 0) logger.info(result, "callback job processed");
    } catch (error) {
      logger.error({ err: error }, "callback job failed");
    } finally {
      this.running = false;
    }
  }
}
