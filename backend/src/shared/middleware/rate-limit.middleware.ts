import type { Request, RequestHandler } from "express";
import type { Redis } from "ioredis";
import { logger } from "@config/logger.js";
import { TooManyRequestsError } from "@shared/errors/AppError.js";

/** Counts hits per key in fixed windows. `hit` returns the count in the current window, including this one. */
export interface RateLimitStore {
  hit(key: string, windowMs: number): Promise<number>;
}

/** Shared by every API instance. */
export class RedisRateLimitStore implements RateLimitStore {
  constructor(private readonly redis: Redis) {}

  /** Creates the counter with its expiry only if missing (any Redis version), then counts, in one round trip. */
  async hit(key: string, windowMs: number): Promise<number> {
    const results = await this.redis.multi().set(key, 0, "PX", windowMs, "NX").incr(key).exec();
    const count = results?.[1]?.[1];
    return typeof count === "number" ? count : 0;
  }
}

/** One process only (EVENT_BUS=memory, tests). */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  async hit(key: string, windowMs: number): Promise<number> {
    const now = this.now();
    const current = this.windows.get(key);
    if (!current || current.resetAt <= now) {
      // Expired windows are dropped as they are met again; also sweep when the map grows large.
      if (this.windows.size > 10_000) {
        for (const [k, w] of this.windows) if (w.resetAt <= now) this.windows.delete(k);
      }
      this.windows.set(key, { count: 1, resetAt: now + windowMs });
      return 1;
    }
    current.count += 1;
    return current.count;
  }
}

export interface RateLimitOptions {
  store: RateLimitStore;
  /** Distinguishes limiters that share a store. */
  name: string;
  /** Requests allowed per window; 0 turns the limiter off. */
  limit: number;
  windowMs: number;
  key?: (req: Request) => string;
}

/**
 * Refuses requests over `limit` per window with 429 and `Retry-After`. The client IP is the default key (set
 * TRUST_PROXY behind a load balancer). If the store fails the request is let through: a Redis outage must not lock
 * everyone out of signing in.
 */
export function rateLimit({
  store,
  name,
  limit,
  windowMs,
  key = (req) => req.ip ?? "unknown",
}: RateLimitOptions): RequestHandler {
  if (limit <= 0) return (_req, _res, next) => next();
  return async (req, res, next) => {
    let count = 0;
    try {
      count = await store.hit(`ratelimit:${name}:${key(req)}`, windowMs);
    } catch (error) {
      logger.warn({ err: error, limiter: name }, "rate limit store unavailable; request allowed");
    }
    if (count > limit) {
      res.setHeader("Retry-After", String(Math.ceil(windowMs / 1000)));
      throw new TooManyRequestsError("Too many requests; try again later");
    }
    next();
  };
}
