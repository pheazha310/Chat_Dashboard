import { fromPartial } from "@total-typescript/shoehorn";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeRealtime } from "../../../__tests__/support/realtime.js";
import { uid } from "../../../__tests__/support/ids.js";
import type { AuthContext } from "@shared/auth/auth.types.js";
import type { ChatSettingsRepository } from "../chat-settings.repository.js";
import { ChatSettingsService } from "../chat-settings.service.js";
import { DEFAULT_CHAT_SETTINGS, type ChatSettingsDto } from "../chat-settings.types.js";

vi.mock("@config/logger.js", () => ({ logger: { warn: vi.fn() } }));

const repo = { find: vi.fn(), upsert: vi.fn() };
const realtime = fakeRealtime();
const service = new ChatSettingsService(fromPartial<ChatSettingsRepository>(repo), realtime);
const agent: AuthContext = { userId: uid(1), role: "AGENT" };
const saved = (patch: Partial<ChatSettingsDto>): ChatSettingsDto => ({ ...DEFAULT_CHAT_SETTINGS, ...patch });

beforeEach(() => {
  vi.resetAllMocks();
  for (const mock of Object.values(realtime)) mock.mockResolvedValue(undefined);
  repo.find.mockResolvedValue(null);
});

describe("get", () => {
  it("returns the defaults until something was saved, without creating a row", async () => {
    expect(await service.get(agent)).toEqual({
      typingSoundEnabled: true,
      notificationSoundEnabled: true,
      aiSuggestionsEnabled: true,
      aiSummariesEnabled: true,
      autoAssignEnabled: false,
    });
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it("only ever reads the caller's own row", async () => {
    await service.get(agent);
    expect(repo.find).toHaveBeenCalledWith(uid(1));
  });
});

describe("update", () => {
  it("saves only the given switches for the caller and tells the caller's other sessions", async () => {
    repo.upsert.mockResolvedValue(saved({ autoAssignEnabled: true }));

    const result = await service.update(agent, { autoAssignEnabled: true });

    expect(result.autoAssignEnabled).toBe(true);
    expect(repo.upsert).toHaveBeenCalledWith(uid(1), { autoAssignEnabled: true });
    expect(realtime.agentEvent).toHaveBeenCalledWith(uid(1), "chat_settings.updated", {
      settings: saved({ autoAssignEnabled: true }),
    });
  });

  it("writes and broadcasts nothing when the values are already what the agent has", async () => {
    repo.find.mockResolvedValue(saved({ typingSoundEnabled: false }));

    const result = await service.update(agent, { typingSoundEnabled: false, aiSummariesEnabled: true });

    expect(result).toEqual(saved({ typingSoundEnabled: false }));
    expect(repo.upsert).not.toHaveBeenCalled();
    expect(realtime.agentEvent).not.toHaveBeenCalled();
  });

  it("treats a first save of the default values as no change", async () => {
    await service.update(agent, { notificationSoundEnabled: true });
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it("still succeeds when the realtime publish fails", async () => {
    repo.upsert.mockResolvedValue(saved({ aiSuggestionsEnabled: false }));
    realtime.agentEvent.mockRejectedValue(new Error("redis down"));

    await expect(service.update(agent, { aiSuggestionsEnabled: false })).resolves.toMatchObject({
      aiSuggestionsEnabled: false,
    });
  });
});
