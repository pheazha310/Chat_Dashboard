import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { TooManyRequestsError } from "@shared/errors/AppError.js";
import { MemoryRateLimitStore, rateLimit, type RateLimitStore } from "../rate-limit.middleware.js";

const request = (ip: string) => ({ ip }) as Request;
const response = () => ({ setHeader: vi.fn() }) as unknown as Response & { setHeader: ReturnType<typeof vi.fn> };

describe("rateLimit", () => {
  it("lets `limit` requests through per window and refuses the next with Retry-After", async () => {
    let now = 0;
    const mw = rateLimit({ store: new MemoryRateLimitStore(() => now), name: "t", limit: 2, windowMs: 60_000 });
    const next = vi.fn();
    await mw(request("1.1.1.1"), response(), next);
    await mw(request("1.1.1.1"), response(), next);
    const res = response();
    await expect(mw(request("1.1.1.1"), res, next)).rejects.toBeInstanceOf(TooManyRequestsError);
    expect(res.setHeader).toHaveBeenCalledWith("Retry-After", "60");
    expect(next).toHaveBeenCalledTimes(2);

    // Another address has its own budget, and the window resets.
    await mw(request("2.2.2.2"), response(), next);
    now = 60_000;
    await mw(request("1.1.1.1"), response(), next);
    expect(next).toHaveBeenCalledTimes(4);
  });

  it("is off when the limit is 0", async () => {
    const store = { hit: vi.fn() };
    const next = vi.fn();
    await rateLimit({ store, name: "t", limit: 0, windowMs: 1000 })(request("1.1.1.1"), response(), next);
    expect(next).toHaveBeenCalledOnce();
    expect(store.hit).not.toHaveBeenCalled();
  });

  it("lets requests through when the store is down", async () => {
    const store: RateLimitStore = { hit: vi.fn().mockRejectedValue(new Error("redis down")) };
    const next = vi.fn();
    await rateLimit({ store, name: "t", limit: 1, windowMs: 1000 })(request("1.1.1.1"), response(), next);
    expect(next).toHaveBeenCalledOnce();
  });
});

const redisUrl = process.env.TEST_REDIS_URL;

describe.skipIf(!redisUrl)("RedisRateLimitStore (needs TEST_REDIS_URL)", () => {
  it("counts within a window and starts again after it expires", async () => {
    const { Redis } = await import("ioredis");
    const { RedisRateLimitStore } = await import("../rate-limit.middleware.js");
    const redis = new Redis(redisUrl as string, { maxRetriesPerRequest: 1 });
    try {
      const store = new RedisRateLimitStore(redis);
      const key = `ratelimit:test:${Date.now()}`;
      expect(await store.hit(key, 200)).toBe(1);
      expect(await store.hit(key, 200)).toBe(2);
      const ttl = await redis.pttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(200);
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(await store.hit(key, 200)).toBe(1);
    } finally {
      redis.disconnect();
    }
  });
});
