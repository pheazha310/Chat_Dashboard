import { describe, expect, it, vi } from "vitest";
import type { BusEvent } from "@shared/events/event-bus.js";
import { MemoryEventBus, RedisEventBus } from "../websocket.bus.js";
import { uid } from "../../__tests__/support/ids.js";

vi.mock("@config/logger.js", () => ({ logger: { warn: vi.fn() } }));

const event: BusEvent = { type: "message.new", payload: { id: uid(1) }, audience: { kind: "dashboard" }, except: "c1" };

describe("MemoryEventBus", () => {
  it("delivers a JSON copy to every subscriber and stops after unsubscribe", async () => {
    const bus = new MemoryEventBus();
    const a: BusEvent[] = [];
    const b: BusEvent[] = [];
    const offA = bus.subscribe((e) => a.push(e));
    bus.subscribe((e) => b.push(e));
    await bus.publish(event);
    offA();
    await bus.publish({ ...event, type: "second" });
    expect(a).toEqual([event]);
    expect(b.map((e) => e.type)).toEqual(["message.new", "second"]);
    expect(a[0]).not.toBe(event); // no shared references, as over the wire
  });
});

// Needs a real Redis: TEST_REDIS_URL=redis://127.0.0.1:6379 (a dedicated instance; nothing is written besides pub/sub).
describe.skipIf(!process.env.TEST_REDIS_URL)("RedisEventBus", () => {
  it("fans events out between two instances", async () => {
    const url = process.env.TEST_REDIS_URL as string;
    const instanceA = new RedisEventBus(url);
    const instanceB = new RedisEventBus(url);
    const received: BusEvent[] = [];
    instanceB.subscribe((e) => received.push(e));
    await new Promise((resolve) => setTimeout(resolve, 200)); // let the subscription settle
    await instanceA.publish(event);
    for (let i = 0; i < 50 && received.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 20));
    expect(received).toEqual([event]);
    await Promise.all([instanceA.close(), instanceB.close()]);
  });

  it("fails fast instead of hanging when Redis is unreachable", async () => {
    const bus = new RedisEventBus("redis://127.0.0.1:1");
    await expect(bus.publish(event)).rejects.toThrow(/timed out/);
    await bus.close();
  }, 10_000);
});
