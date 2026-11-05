import { fromPartial } from "@total-typescript/shoehorn";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@shared/auth/auth.types.js";
import { fakeRealtime } from "../../../__tests__/support/realtime.js";
import type { PresenceRepository } from "../presence.repository.js";
import { PresenceService } from "../presence.service.js";

vi.mock("@config/logger.js", () => ({ logger: { warn: vi.fn() } }));

const repo = {
  addSocket: vi.fn(),
  removeSocket: vi.fn(),
  refreshSocket: vi.fn(),
  markOnline: vi.fn(),
  chosenStatus: vi.fn(),
  setChosenStatus: vi.fn(),
  onlineWithStatus: vi.fn(),
  recordPeriod: vi.fn(),
};
const realtime = fakeRealtime();
const service = new PresenceService(fromPartial<PresenceRepository>(repo), realtime);
const agent: AuthContext = { userId: 1n, role: "AGENT" };

beforeEach(() => {
  vi.resetAllMocks();
  for (const mock of Object.values(realtime)) mock.mockResolvedValue(undefined);
  repo.chosenStatus.mockResolvedValue(null);
  repo.onlineWithStatus.mockResolvedValue([]);
});

describe("PresenceService", () => {
  it("announces AVAILABLE only for the first socket", async () => {
    repo.addSocket.mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    await service.connect(agent, "a");
    expect(realtime.presenceChanged).toHaveBeenCalledWith(1n, "AVAILABLE");
    expect(repo.recordPeriod).toHaveBeenCalledWith(1n, "AVAILABLE");
    await service.connect(agent, "b");
    expect(realtime.presenceChanged).toHaveBeenCalledTimes(1);
  });

  it("restores the status the agent chose last time", async () => {
    repo.addSocket.mockResolvedValue(1);
    repo.chosenStatus.mockResolvedValue("BUSY");
    await service.connect(agent, "a");
    expect(realtime.presenceChanged).toHaveBeenCalledWith(1n, "BUSY");
  });

  it("announces OFFLINE only when the last socket closes", async () => {
    repo.removeSocket.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    await service.disconnect(agent, "a");
    expect(realtime.presenceChanged).not.toHaveBeenCalled();
    await service.disconnect(agent, "b");
    expect(repo.markOnline).toHaveBeenCalledWith(1n, false);
    expect(realtime.presenceChanged).toHaveBeenCalledWith(1n, "OFFLINE");
  });

  it("broadcasts a chosen status while online, and only remembers it while offline", async () => {
    repo.onlineWithStatus.mockResolvedValue([{ userId: 1n, chosen: "AWAY" }]);
    expect(await service.setStatus(agent, { status: "AWAY" })).toEqual({ userId: "1", status: "AWAY" });
    expect(realtime.presenceChanged).toHaveBeenCalledWith(1n, "AWAY");
    realtime.presenceChanged.mockClear();
    repo.onlineWithStatus.mockResolvedValue([]);
    expect(await service.setStatus(agent, { status: "BUSY" })).toEqual({ userId: "1", status: "OFFLINE" });
    expect(repo.setChosenStatus).toHaveBeenLastCalledWith(1n, "BUSY");
    expect(realtime.presenceChanged).not.toHaveBeenCalled();
  });

  it("lists online agents with their chosen status, defaulting to AVAILABLE", async () => {
    repo.onlineWithStatus.mockResolvedValue([
      { userId: 1n, chosen: "BUSY" },
      { userId: 2n, chosen: null },
    ]);
    expect(await service.snapshot()).toEqual([
      { userId: "1", status: "BUSY" },
      { userId: "2", status: "AVAILABLE" },
    ]);
  });

  it("never blocks or fails a connection when Redis is down", async () => {
    repo.addSocket.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(service.connect(agent, "a")).resolves.toBeUndefined();
    repo.removeSocket.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(service.disconnect(agent, "a")).resolves.toBeUndefined();
  });

  it("keeps the presence history going even if announcing it fails", async () => {
    repo.addSocket.mockResolvedValue(1);
    repo.recordPeriod.mockRejectedValue(new Error("db down"));
    await service.connect(agent, "a");
    expect(realtime.presenceChanged).toHaveBeenCalledWith(1n, "AVAILABLE");
  });
});
