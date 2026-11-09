import { fromPartial } from "@total-typescript/shoehorn";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError } from "@shared/errors/AppError.js";
import type { ChatIdentityRepository } from "../chat-identity.repository.js";
import { ChatIdentityService } from "../chat-identity.service.js";
import { uid } from "../../../__tests__/support/ids.js";

const repo = { upsert: vi.fn() };
const service = new ChatIdentityService(fromPartial<ChatIdentityRepository>(repo));

beforeEach(() => {
  vi.resetAllMocks();
  repo.upsert.mockResolvedValue({ id: uid(900), status: "ACTIVE" });
});

describe("resolve", () => {
  it("maps a customer token to a CUSTOMER chat user keyed by the Backend 1 id", async () => {
    await expect(service.resolve({ userId: uid(100), role: "CUSTOMER" })).resolves.toEqual({ chatUserId: uid(900) });
    expect(repo.upsert).toHaveBeenCalledWith("CUSTOMER", uid(100), "CUSTOMER");
  });

  it.each(["AGENT", "SUPERVISOR", "ADMIN"] as const)(
    "maps %s to a STAFF chat user and records the role",
    async (role) => {
      await service.resolve({ userId: uid(1), role });
      expect(repo.upsert).toHaveBeenCalledWith("STAFF", uid(1), role);
    },
  );

  it("refuses a disabled chat user", async () => {
    repo.upsert.mockResolvedValue({ id: uid(900), status: "DISABLED" });
    await expect(service.resolve({ userId: uid(1), role: "AGENT" })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
