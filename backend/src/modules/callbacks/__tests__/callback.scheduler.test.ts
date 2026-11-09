import { afterEach, describe, expect, it, vi } from "vitest";
import { CallbackScheduler } from "../callback.scheduler.js";

vi.mock("@config/logger.js", () => ({ logger: { info: vi.fn(), error: vi.fn() } }));

afterEach(() => vi.useRealTimers());

describe("CallbackScheduler", () => {
  it("runs the job on every interval until stopped", async () => {
    vi.useFakeTimers();
    const processDue = vi.fn().mockResolvedValue({ missed: 0, reminded: 0 });
    const job = new CallbackScheduler({ processDue }, 1000);
    job.start();
    job.start(); // a second start does not add a second timer
    await vi.advanceTimersByTimeAsync(3000);
    expect(processDue).toHaveBeenCalledTimes(3);
    job.stop();
    await vi.advanceTimersByTimeAsync(3000);
    expect(processDue).toHaveBeenCalledTimes(3);
  });

  it("does not start when the interval is 0", async () => {
    vi.useFakeTimers();
    const processDue = vi.fn();
    new CallbackScheduler({ processDue }, 0).start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(processDue).not.toHaveBeenCalled();
  });

  it("skips a tick while the previous pass is still running, and keeps going after a failure", async () => {
    let finish: () => void = () => {};
    const processDue = vi
      .fn()
      .mockReturnValueOnce(new Promise<void>((resolve) => (finish = resolve)).then(() => ({ missed: 0, reminded: 0 })))
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValue({ missed: 0, reminded: 0 });
    const job = new CallbackScheduler({ processDue }, 1000);

    const first = job.tick();
    await job.tick(); // overlapping: skipped
    expect(processDue).toHaveBeenCalledTimes(1);
    finish();
    await first;

    await job.tick(); // fails, is logged, does not throw
    await job.tick();
    expect(processDue).toHaveBeenCalledTimes(3);
  });
});
