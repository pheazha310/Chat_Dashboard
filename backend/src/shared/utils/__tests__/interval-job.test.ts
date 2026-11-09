import { afterEach, describe, expect, it, vi } from "vitest";
import { IntervalJob } from "../interval-job.js";

vi.mock("@config/logger.js", () => ({ logger: { info: vi.fn(), error: vi.fn() } }));

afterEach(() => vi.useRealTimers());

describe("IntervalJob", () => {
  it("runs on every interval until stopped, and a second start adds no second timer", async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockResolvedValue({ handled: 0 });
    const job = new IntervalJob("test", run, 1000);
    job.start();
    job.start();
    await vi.advanceTimersByTimeAsync(3000);
    expect(run).toHaveBeenCalledTimes(3);
    job.stop();
    await vi.advanceTimersByTimeAsync(3000);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("does not start when the interval is 0", async () => {
    vi.useFakeTimers();
    const run = vi.fn();
    new IntervalJob("test", run, 0).start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).not.toHaveBeenCalled();
  });

  it("skips a tick while the previous pass is still running, and keeps going after a failure", async () => {
    let finish: () => void = () => {};
    const run = vi
      .fn()
      .mockReturnValueOnce(new Promise<object>((resolve) => (finish = () => resolve({}))))
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValue({});
    const job = new IntervalJob("test", run, 1000);

    const first = job.tick();
    await job.tick(); // overlapping: skipped
    expect(run).toHaveBeenCalledTimes(1);
    finish();
    await first;

    await job.tick(); // fails, is logged, does not throw
    await job.tick();
    expect(run).toHaveBeenCalledTimes(3);
  });
});
