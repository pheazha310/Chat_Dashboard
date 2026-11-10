import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendVoice = vi.hoisted(() => vi.fn());
vi.mock("./files", () => ({ sendVoice }));
vi.mock("@/shared/api/rest", () => ({ clearDraftRequest: vi.fn(), saveDraftRequest: vi.fn() }));
vi.mock("@/shared/api/ws", () => ({ wsClient: { send: vi.fn() } }));
vi.mock("@/shared/ui", () => ({ notify: vi.fn() }));

import { useComposerStore } from "./store";
import { startVoiceRecording, stopVoiceRecording } from "./voice";

/** A MediaRecorder that hands back one chunk when stopped. */
class FakeRecorder {
  static isTypeSupported = (mime: string) => mime === "audio/webm";
  state = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob([new Uint8Array(4)], { type: "audio/webm" }) });
    this.onstop?.();
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-10T09:00:00Z"));
  sendVoice.mockClear();
  useComposerStore.setState({ recording: false, recordingSince: null });
  vi.stubGlobal("window", globalThis); // the tests run in Node: the module's window timers are the global ones
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }) },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("voice recording", () => {
  it("shows when recording started, then sends the recording with its length", async () => {
    await startVoiceRecording("a");
    expect(useComposerStore.getState()).toMatchObject({ recording: true, recordingSince: Date.now() });

    vi.advanceTimersByTime(7_000);
    stopVoiceRecording(true);
    expect(useComposerStore.getState()).toMatchObject({ recording: false, recordingSince: null });
    expect(sendVoice).toHaveBeenCalledWith("a", expect.any(File), 7_000);
    expect((sendVoice.mock.calls[0]![1] as File).name).toBe("voice-message.webm");
  });

  it("throws a cancelled recording away", async () => {
    await startVoiceRecording("a");
    stopVoiceRecording(false);
    expect(sendVoice).not.toHaveBeenCalled();
    expect(useComposerStore.getState().recordingSince).toBeNull();
  });
});
