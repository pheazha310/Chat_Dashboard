import { beforeEach, describe, expect, it, vi } from "vitest";
import { UnauthorizedError } from "@shared/errors/AppError.js";
import { IDENTITY_CACHE_MS, MappedAuthClient } from "../mapped-auth-client.js";
import { uid } from "../../../__tests__/support/ids.js";

const inner = { verifyToken: vi.fn() };
const identities = { resolve: vi.fn() };
let now = 1_000;
let client: MappedAuthClient;

beforeEach(() => {
  vi.resetAllMocks();
  now = 1_000;
  client = new MappedAuthClient(inner, identities, () => now); // fresh cache per test
  inner.verifyToken.mockResolvedValue({ userId: uid(1), role: "AGENT" });
  identities.resolve.mockResolvedValue({ chatUserId: uid(900) });
});

describe("MappedAuthClient", () => {
  it("adds the chat user id to the verified identity", async () => {
    expect(await client.verifyToken("t")).toEqual({ userId: uid(1), role: "AGENT", chatUserId: uid(900) });
  });

  it("carries the role's permissions, also from the cache", async () => {
    identities.resolve.mockResolvedValue({ chatUserId: uid(900), permissions: new Set(["tags.delete"]) });
    expect((await client.verifyToken("t")).permissions).toEqual(new Set(["tags.delete"]));
    expect((await client.verifyToken("t")).permissions).toEqual(new Set(["tags.delete"]));
    expect(identities.resolve).toHaveBeenCalledTimes(1);
  });

  it("does not map an identity whose token is invalid", async () => {
    inner.verifyToken.mockRejectedValue(new UnauthorizedError("Invalid token"));
    await expect(client.verifyToken("bad")).rejects.toBeInstanceOf(UnauthorizedError);
    expect(identities.resolve).not.toHaveBeenCalled();
  });

  it("reuses the mapping for a minute, then asks again", async () => {
    await client.verifyToken("t");
    await client.verifyToken("t");
    expect(identities.resolve).toHaveBeenCalledTimes(1);
    now += IDENTITY_CACHE_MS + 1;
    await client.verifyToken("t");
    expect(identities.resolve).toHaveBeenCalledTimes(2);
  });

  it("does not cache a refusal, so a disabled user stays refused", async () => {
    identities.resolve.mockRejectedValue(new Error("disabled"));
    await expect(client.verifyToken("t")).rejects.toThrow("disabled");
    await expect(client.verifyToken("t")).rejects.toThrow("disabled");
    expect(identities.resolve).toHaveBeenCalledTimes(2);
  });
});
