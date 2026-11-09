import { vi } from "vitest";
import type { RealtimeNotifier } from "@shared/ports/realtime.js";

/** A RealtimeNotifier whose every method is a resolved mock, for service unit tests. */
export const fakeRealtime = () =>
  ({
    messageCreated: vi.fn().mockResolvedValue(undefined),
    messageEvent: vi.fn().mockResolvedValue(undefined),
    messageStatus: vi.fn().mockResolvedValue(undefined),
    conversationEvent: vi.fn().mockResolvedValue(undefined),
    readState: vi.fn().mockResolvedValue(undefined),
    presenceChanged: vi.fn().mockResolvedValue(undefined),
    typing: vi.fn().mockResolvedValue(undefined),
    notificationRead: vi.fn().mockResolvedValue(undefined),
    notification: vi.fn().mockResolvedValue(undefined),
    agentEvent: vi.fn().mockResolvedValue(undefined),
  }) satisfies RealtimeNotifier;
