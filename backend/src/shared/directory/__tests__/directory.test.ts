import { describe, expect, it, vi } from "vitest";
import type { Directory } from "@shared/ports/directory.js";
import { CachedDirectory } from "../cached-directory.js";
import { DevDirectory } from "../dev-directory.js";
import { uid } from "../../../__tests__/support/ids.js";

describe("DevDirectory", () => {
  it("returns clearly synthetic data and labels its source", async () => {
    const directory = new DevDirectory();
    expect(directory.source).toBe("dev-stub");
    expect((await directory.getCustomer(uid(5))).email).toMatch(/@example\.test$/);
    expect(await directory.getAgents([uid(1), uid(2)])).toEqual([
      { id: uid(1), name: `Agent ${uid(1)}`, avatarUrl: null },
      { id: uid(2), name: `Agent ${uid(2)}`, avatarUrl: null },
    ]);
  });
});

describe("CachedDirectory", () => {
  const inner = () => {
    const getAgents = vi.fn(async (ids: string[]) =>
      ids.filter((id) => id !== uid(99)).map((id) => ({ id: String(id), name: `A${id}`, avatarUrl: null })),
    );
    const getCustomer = vi.fn(async () => null);
    return { getAgents, getCustomer, source: "inner" } satisfies Directory;
  };

  it("asks Backend 1 only for agents it has not seen recently, once per id", async () => {
    const backend = inner();
    let now = 0;
    const directory = new CachedDirectory(backend, 1000, () => now);
    await directory.getAgents([uid(1), uid(2), uid(1)]);
    await directory.getAgents([uid(2), uid(3)]);
    expect(backend.getAgents.mock.calls).toEqual([[[uid(1), uid(2)]], [[uid(3)]]]);
    now = 1500; // expired
    await directory.getAgents([uid(1)]);
    expect(backend.getAgents).toHaveBeenCalledTimes(3);
  });

  it("remembers that an id is unknown instead of asking again", async () => {
    const backend = inner();
    const directory = new CachedDirectory(backend);
    expect(await directory.getAgents([uid(99), uid(1)])).toEqual([{ id: uid(1), name: `A${uid(1)}`, avatarUrl: null }]);
    await directory.getAgents([uid(99)]);
    expect(backend.getAgents).toHaveBeenCalledTimes(1);
  });

  it("never caches customers, and exposes the inner source", async () => {
    const backend = inner();
    const directory = new CachedDirectory(backend);
    await directory.getCustomer(uid(1));
    await directory.getCustomer(uid(1));
    expect(backend.getCustomer).toHaveBeenCalledTimes(2);
    expect(directory.source).toBe("inner");
  });
});
