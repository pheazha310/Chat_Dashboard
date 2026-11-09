import { logger } from "@config/logger.js";

/**
 * Runs `run` on a timer inside the API process. A pass that is still running when the next tick arrives makes that
 * tick skip, and a failing pass is logged and does not stop the timer. It does no leader election: jobs built on it
 * claim their rows in the database, so several instances never repeat work.
 */
export class IntervalJob {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly name: string,
    private readonly run: () => Promise<object>,
    private readonly intervalMs: number,
  ) {}

  /** Does nothing when the interval is 0. Starting twice does not add a second timer. */
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
      const result = await this.run();
      if (Object.values(result).some((count) => typeof count === "number" && count > 0)) {
        logger.info(result, `${this.name} job processed`);
      }
    } catch (error) {
      logger.error({ err: error }, `${this.name} job failed`);
    } finally {
      this.running = false;
    }
  }
}
