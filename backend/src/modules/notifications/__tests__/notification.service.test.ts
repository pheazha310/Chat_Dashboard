import { fromPartial } from "@total-typescript/shoehorn";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationRepository } from "../notification.repository.js";
import { NotificationService } from "../notification.service.js";

const repo = { findPreferences: vi.fn(), isMuted: vi.fn(), create: vi.fn() };
const service = new NotificationService(fromPartial<NotificationRepository>(repo));
const base = { agentId: 1n, title: "t", conversationId: 5n };

beforeEach(() => {
  vi.resetAllMocks();
  repo.findPreferences.mockResolvedValue(null);
  repo.isMuted.mockResolvedValue(false);
});

describe("NotificationService.notifyAgent", () => {
  it("stores by default when the agent has no preferences row", async () => {
    await expect(service.notifyAgent({ ...base, type: "ASSIGNED" })).resolves.toBe(true);
    expect(repo.create).toHaveBeenCalledOnce();
  });

  it("honours the per-type preference switches", async () => {
    repo.findPreferences.mockResolvedValue({ assignmentEnabled: false, transferEnabled: true });
    await expect(service.notifyAgent({ ...base, type: "ASSIGNED" })).resolves.toBe(false);
    await expect(service.notifyAgent({ ...base, type: "TRANSFERRED" })).resolves.toBe(true);
    expect(repo.create).toHaveBeenCalledTimes(1);
  });

  it("skips new-message notifications for muted conversations only", async () => {
    repo.isMuted.mockResolvedValue(true);
    await expect(service.notifyAgent({ ...base, type: "NEW_MESSAGE" })).resolves.toBe(false);
    await expect(service.notifyAgent({ ...base, type: "ASSIGNED" })).resolves.toBe(true);
  });
});
