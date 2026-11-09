import { describe, expect, it, vi } from "vitest";
import type { AuthClient } from "@shared/auth/auth.types.js";
import { ForbiddenError, UnauthorizedError } from "@shared/errors/AppError.js";
import { uid } from "../../../__tests__/support/ids.js";
import { AccountCheckedAuthClient, type AccountLookup } from "../auth.account-check.js";

const USER = uid(1);
const inner: AuthClient = { verifyToken: async () => ({ userId: USER, role: "ADMIN" }) };

function setup(account: { role: string; status: string } | null) {
  let now = 0;
  const lookup = { account: vi.fn<AccountLookup["account"]>().mockResolvedValue(account) };
  const client = new AccountCheckedAuthClient(inner, lookup, 60_000, () => now);
  return { client, lookup, advance: (ms: number) => (now += ms) };
}

describe("AccountCheckedAuthClient", () => {
  it("accepts a token whose account is active with the same role, reading the account once per minute", async () => {
    const { client, lookup, advance } = setup({ role: "ADMIN", status: "ACTIVE" });
    await expect(client.verifyToken("t")).resolves.toEqual({ userId: USER, role: "ADMIN" });
    await client.verifyToken("t");
    expect(lookup.account).toHaveBeenCalledTimes(1);
    advance(60_001);
    await client.verifyToken("t");
    expect(lookup.account).toHaveBeenCalledTimes(2);
  });

  it("refuses a token once the role changed, after the cache expires", async () => {
    const { client, lookup, advance } = setup({ role: "ADMIN", status: "ACTIVE" });
    await client.verifyToken("t");
    lookup.account.mockResolvedValue({ role: "AGENT", status: "ACTIVE" });
    await expect(client.verifyToken("t")).resolves.toBeDefined();
    advance(60_001);
    await expect(client.verifyToken("t")).rejects.toThrow(
      new UnauthorizedError("Access token is out of date; sign in again"),
    );
  });

  it("refuses a disabled account (403) and a missing one (401)", async () => {
    await expect(setup({ role: "ADMIN", status: "DISABLED" }).client.verifyToken("t")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(setup(null).client.verifyToken("t")).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("does not look up the account when the token itself is invalid", async () => {
    const lookup = { account: vi.fn<AccountLookup["account"]>() };
    const bad: AuthClient = { verifyToken: () => Promise.reject(new UnauthorizedError("Invalid token")) };
    await expect(new AccountCheckedAuthClient(bad, lookup).verifyToken("t")).rejects.toBeInstanceOf(UnauthorizedError);
    expect(lookup.account).not.toHaveBeenCalled();
  });
});
