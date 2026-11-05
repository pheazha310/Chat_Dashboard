import { describe, expect, it, vi } from "vitest";
import type { Directory } from "@shared/ports/directory.js";
import { CachedDirectory } from "../cached-directory.js";
import { DevDirectory } from "../dev-directory.js";

describe("DevDirectory", () => {
  it("returns clearly synthetic data and labels its source", async () => {
    const directory = new DevDirectory();
    expect(directory.source).toBe("dev-stub");
    expect((await directory.getCustomer(5n)).email).toMatch(/@example\.test$/);
    expect(await directory.getAgents([1n, 2n])).toEqual([
      { id: "1", name: "Agent 1", avatarUrl: null },
      { id: "2", name: "Agent 2", avatarUrl: null },
    ]);
  });
});

describe("CachedDirectory", () => {
  const inner = () => {
    const getAgents = vi.fn(async (ids: bigint[]) =>
      ids.filter((id) => id !== 99n).map((id) => ({ id: String(id), name: `A${id}`, avatarUrl: null })),
    );
    const getCustomer = vi.fn(async () => null);
    return { getAgents, getCustomer, source: "inner" } satisfies Directory;
  };

  it("asks Backend 1 only for agents it has not seen recently, once per id", async () => {
    const backend = inner();
    let now = 0;
    const directory = new CachedDirectory(backend, 1000, () => now);
    await directory.getAgents([1n, 2n, 1n]);
    await directory.getAgents([2n, 3n]);
    expect(backend.getAgents.mock.calls).toEqual([[[1n, 2n]], [[3n]]]);
    now = 1500; // expired
    await directory.getAgents([1n]);
    expect(backend.getAgents).toHaveBeenCalledTimes(3);
  });

  it("remembers that an id is unknown instead of asking again", async () => {
    const backend = inner();
    const directory = new CachedDirectory(backend);
    expect(await directory.getAgents([99n, 1n])).toEqual([{ id: "1", name: "A1", avatarUrl: null }]);
    await directory.getAgents([99n]);
    expect(backend.getAgents).toHaveBeenCalledTimes(1);
  });

  it("never caches customers, and exposes the inner source", async () => {
    const backend = inner();
    const directory = new CachedDirectory(backend);
    await directory.getCustomer(1n);
    await directory.getCustomer(1n);
    expect(backend.getCustomer).toHaveBeenCalledTimes(2);
    expect(directory.source).toBe("inner");
  });
});
