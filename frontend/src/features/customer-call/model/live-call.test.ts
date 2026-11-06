import { beforeEach, describe, expect, it, vi } from "vitest";

const rest = vi.hoisted(() => ({
  acceptCallRequest: vi.fn(),
  cancelCallRequest: vi.fn(),
  declineCallRequest: vi.fn(),
  endCallRequest: vi.fn(),
  getCallConfig: vi.fn(),
  startCallRequest: vi.fn(),
}));
const send = vi.hoisted(() => vi.fn());
const notify = vi.hoisted(() => vi.fn());
vi.mock("@/shared/api/rest", () => rest);
vi.mock("@/shared/api/ws", () => ({ wsClient: { send } }));
vi.mock("@/shared/ui", () => ({ notify }));
vi.mock("@/entities/conversation", () => ({
  useConversationStore: { getState: () => ({ byId: { a: { name: "Maya Chen" } } }) },
}));
vi.mock("@/shared/api/session", () => ({ useSessionStore: { getState: () => ({ userId: "me" }) } }));

import type { Call } from "@/shared/api/rest";
import {
  acceptIncomingCall,
  declineIncomingCall,
  endLiveCall,
  onCallAccepted,
  onCallAnswer,
  onCallCandidate,
  onCallDeclined,
  onCallEnded,
  onCallIncoming,
  onCallOffer,
  setRtc,
  startLiveCall,
  toggleMute,
  useLiveCallStore as store,
} from "./live-call";

class FakeTrack {
  enabled = true;
  stopped = false;
  stop() {
    this.stopped = true;
  }
}
class FakePeer {
  tracks: FakeTrack[] = [];
  closed = false;
  connectionState = "new";
  remote: unknown = null;
  local: unknown = null;
  added: unknown[] = [];
  onicecandidate: ((event: { candidate: { toJSON: () => object } | null }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  ontrack: ((event: { streams: unknown[]; track: unknown }) => void) | null = null;
  addTrack(track: FakeTrack) {
    this.tracks.push(track);
  }
  createOffer = async () => ({ type: "offer", sdp: "local-offer" });
  createAnswer = async () => ({ type: "answer", sdp: "local-answer" });
  setLocalDescription = async (description: unknown) => void (this.local = description);
  setRemoteDescription = async (description: unknown) => void (this.remote = description);
  addIceCandidate = async (candidate: unknown) => void this.added.push(candidate);
  close() {
    this.closed = true;
  }
}

let peer: FakePeer;
let track: FakeTrack;
const stream = () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) as unknown as MediaStream;

const call = (patch: Partial<Call> = {}): Call => ({
  id: "c1",
  conversationId: "a",
  callType: "AUDIO",
  status: "RINGING",
  initiatedBy: { type: "AGENT", id: "me" },
  participants: [],
  startedAt: null,
  endedAt: null,
  durationSeconds: null,
  createdAt: "2030-01-01T00:00:00.000Z",
  ...patch,
});
const customerCall = (patch: Partial<Call> = {}) => call({ initiatedBy: { type: "CUSTOMER", id: "cust" }, ...patch });
const from = { type: "CUSTOMER", id: "cust" };
const phase = () => store.getState().phase;
const sent = (type: string) => send.mock.calls.filter(([name]) => name === type).map(([, payload]) => payload);

beforeEach(async () => {
  vi.resetAllMocks();
  peer = new FakePeer();
  track = new FakeTrack();
  setRtc({
    getMicrophone: async () => stream(),
    createPeer: () => peer as unknown as RTCPeerConnection,
  });
  rest.getCallConfig.mockResolvedValue({ iceServers: [{ urls: ["stun:s"] }], ringTimeoutSeconds: 45 });
  rest.startCallRequest.mockResolvedValue(call());
  rest.acceptCallRequest.mockResolvedValue(customerCall({ status: "ACTIVE" }));
  for (const request of [rest.declineCallRequest, rest.cancelCallRequest, rest.endCallRequest]) {
    request.mockResolvedValue(call());
  }
  await endLiveCall(); // back to idle
  vi.resetAllMocks();
  rest.getCallConfig.mockResolvedValue({ iceServers: [{ urls: ["stun:s"] }], ringTimeoutSeconds: 45 });
  rest.startCallRequest.mockResolvedValue(call());
  rest.acceptCallRequest.mockResolvedValue(customerCall({ status: "ACTIVE" }));
  for (const request of [rest.declineCallRequest, rest.cancelCallRequest, rest.endCallRequest]) {
    request.mockResolvedValue(call());
  }
});

describe("calling a customer", () => {
  it("rings, then negotiates once the customer answers: offer out, answer in, audio flowing", async () => {
    await startLiveCall({ id: "a", name: "Maya Chen" });
    expect(phase()).toBe("calling");
    expect(store.getState().name).toBe("Maya Chen");

    await onCallAccepted({ call: call({ status: "ACTIVE" }), by: { type: "CUSTOMER", id: "cust" } });
    expect(phase()).toBe("connecting");
    expect(peer.tracks).toHaveLength(1);
    expect(sent("call.offer")).toEqual([{ callId: "c1", sdp: "local-offer" }]);

    await onCallAnswer({ callId: "c1", from, sdp: "remote-answer" });
    expect(peer.remote).toEqual({ type: "answer", sdp: "remote-answer" });

    peer.connectionState = "connected";
    peer.onconnectionstatechange?.();
    expect(phase()).toBe("active");
    expect(store.getState().connectedAt).not.toBeNull();
  });

  it("holds early candidates until the answer is set, then adds them in order", async () => {
    await startLiveCall({ id: "a", name: "Maya Chen" });
    await onCallAccepted({ call: call({ status: "ACTIVE" }), by: { type: "CUSTOMER", id: "cust" } });

    await onCallCandidate({ callId: "c1", from, candidate: { candidate: "one" } });
    await onCallCandidate({ callId: "c1", from, candidate: { candidate: "two" } });
    expect(peer.added).toEqual([]);

    await onCallAnswer({ callId: "c1", from, sdp: "remote-answer" });
    await onCallCandidate({ callId: "c1", from, candidate: null });
    expect(peer.added).toEqual([{ candidate: "one" }, { candidate: "two" }, undefined]);
  });

  it("sends the browser's own candidates, and the end-of-candidates marker", async () => {
    await startLiveCall({ id: "a", name: "Maya Chen" });
    await onCallAccepted({ call: call({ status: "ACTIVE" }), by: { type: "CUSTOMER", id: "cust" } });
    peer.onicecandidate?.({ candidate: { toJSON: () => ({ candidate: "mine", sdpMid: "0" }) } });
    peer.onicecandidate?.({ candidate: null });
    expect(sent("call.ice_candidate")).toEqual([
      { callId: "c1", candidate: { candidate: "mine", sdpMid: "0" } },
      { callId: "c1", candidate: null },
    ]);
  });

  it("cancels while ringing and hangs up once connected, releasing the microphone and the connection", async () => {
    await startLiveCall({ id: "a", name: "Maya Chen" });
    await endLiveCall();
    expect(rest.cancelCallRequest).toHaveBeenCalledWith("c1");
    expect(rest.endCallRequest).not.toHaveBeenCalled();
    expect(phase()).toBe("idle");

    await startLiveCall({ id: "a", name: "Maya Chen" });
    await onCallAccepted({ call: call({ status: "ACTIVE" }), by: { type: "CUSTOMER", id: "cust" } });
    await endLiveCall();
    expect(rest.endCallRequest).toHaveBeenCalledWith("c1");
    expect(peer.closed).toBe(true);
    expect(track.stopped).toBe(true);
    expect(phase()).toBe("idle");
  });

  it("refuses a second call, and reports a refusal from the server", async () => {
    await startLiveCall({ id: "a", name: "Maya Chen" });
    await startLiveCall({ id: "b", name: "Other" });
    expect(rest.startCallRequest).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("You are already in a call");

    await endLiveCall();
    rest.startCallRequest.mockRejectedValue(new Error("This conversation already has a call"));
    await startLiveCall({ id: "a", name: "Maya Chen" });
    expect(phase()).toBe("idle");
    expect(notify).toHaveBeenCalledWith("This conversation already has a call");
  });

  it("ends the call and says so when the microphone is refused", async () => {
    setRtc({
      getMicrophone: async () => Promise.reject(new Error("Permission denied")),
      createPeer: () => peer as never,
    });
    await startLiveCall({ id: "a", name: "Maya Chen" });
    await onCallAccepted({ call: call({ status: "ACTIVE" }), by: { type: "CUSTOMER", id: "cust" } });
    expect(notify).toHaveBeenCalledWith("Permission denied");
    expect(rest.endCallRequest).toHaveBeenCalledWith("c1");
    expect(phase()).toBe("idle");
  });

  it("ends the call when the connection fails", async () => {
    await startLiveCall({ id: "a", name: "Maya Chen" });
    await onCallAccepted({ call: call({ status: "ACTIVE" }), by: { type: "CUSTOMER", id: "cust" } });
    peer.connectionState = "failed";
    peer.onconnectionstatechange?.();
    await vi.waitFor(() => expect(phase()).toBe("idle"));
    expect(notify).toHaveBeenCalledWith("The call connection failed");
  });

  it("mutes by switching the microphone track off, not by stopping it", async () => {
    await startLiveCall({ id: "a", name: "Maya Chen" });
    await onCallAccepted({ call: call({ status: "ACTIVE" }), by: { type: "CUSTOMER", id: "cust" } });
    toggleMute();
    expect(track.enabled).toBe(false);
    expect(track.stopped).toBe(false);
    expect(store.getState().muted).toBe(true);
    toggleMute();
    expect(track.enabled).toBe(true);
  });
});

describe("a customer calling", () => {
  it("shows the call, and answering negotiates as the callee", async () => {
    onCallIncoming({ call: customerCall() });
    expect(phase()).toBe("incoming");
    expect(store.getState().name).toBe("Maya Chen");

    await acceptIncomingCall();
    expect(rest.acceptCallRequest).toHaveBeenCalledWith("c1");
    expect(phase()).toBe("connecting");

    await onCallOffer({ callId: "c1", from, sdp: "remote-offer" });
    expect(peer.remote).toEqual({ type: "offer", sdp: "remote-offer" });
    expect(sent("call.answer")).toEqual([{ callId: "c1", sdp: "local-answer" }]);
  });

  it("keeps an offer and candidates that arrive while the microphone prompt is still open", async () => {
    let release: () => void = () => {};
    setRtc({
      getMicrophone: () => new Promise<MediaStream>((resolve) => (release = () => resolve(stream()))),
      createPeer: () => peer as never,
    });
    onCallIncoming({ call: customerCall() });
    const accepting = acceptIncomingCall();
    await vi.waitFor(() => expect(rest.getCallConfig).toHaveBeenCalled());

    await onCallOffer({ callId: "c1", from, sdp: "early-offer" });
    await onCallCandidate({ callId: "c1", from, candidate: { candidate: "early" } });
    expect(sent("call.answer")).toEqual([]);

    release();
    await accepting;
    expect(peer.remote).toEqual({ type: "offer", sdp: "early-offer" });
    expect(sent("call.answer")).toEqual([{ callId: "c1", sdp: "local-answer" }]);
    expect(peer.added).toEqual([{ candidate: "early" }]);
  });

  it("declines, and clears the dialog right away", async () => {
    onCallIncoming({ call: customerCall() });
    await declineIncomingCall();
    expect(rest.declineCallRequest).toHaveBeenCalledWith("c1");
    expect(phase()).toBe("idle");
  });

  it("ignores a call while busy and the echo of our own outgoing call", async () => {
    await startLiveCall({ id: "a", name: "Maya Chen" });
    onCallIncoming({ call: customerCall({ id: "c2" }) });
    expect(store.getState().call?.id).toBe("c1");
    await endLiveCall();
    onCallIncoming({ call: call({ id: "c3" }) }); // started by an agent
    expect(phase()).toBe("idle");
  });

  it("closes the dialog when another window or agent answers, but not when we did", async () => {
    onCallIncoming({ call: customerCall() });
    await onCallAccepted({ call: customerCall({ status: "ACTIVE" }), by: { type: "AGENT", id: "colleague" } });
    expect(phase()).toBe("idle");
    expect(notify).toHaveBeenCalledWith("The call was answered by someone else");

    onCallIncoming({ call: customerCall() });
    await onCallAccepted({ call: customerCall({ status: "ACTIVE" }), by: { type: "AGENT", id: "me" } });
    expect(phase()).toBe("incoming");
  });
});

describe("the call ending", () => {
  it("clears the dialog with a reason when the call is over for everyone", async () => {
    onCallIncoming({ call: customerCall() });
    onCallEnded({ call: customerCall({ status: "CANCELLED" }), reason: "cancelled" });
    expect(phase()).toBe("idle");
    expect(notify).toHaveBeenCalledWith("The customer hung up before you answered");
  });

  it("reports a declined call, and ignores events about other calls", async () => {
    await startLiveCall({ id: "a", name: "Maya Chen" });
    onCallEnded({ call: call({ id: "other" }), reason: "ended" });
    onCallDeclined({ call: call({ id: "other" }), by: { type: "CUSTOMER", id: "cust" } });
    expect(phase()).toBe("calling");

    onCallDeclined({ call: call({ status: "DECLINED" }), by: { type: "CUSTOMER", id: "cust" } });
    expect(phase()).toBe("idle");
    expect(notify).toHaveBeenCalledWith("The customer declined the call");
  });

  it("releases the connection when the other side hangs up", async () => {
    await startLiveCall({ id: "a", name: "Maya Chen" });
    await onCallAccepted({ call: call({ status: "ACTIVE" }), by: { type: "CUSTOMER", id: "cust" } });
    onCallEnded({ call: call({ status: "ENDED" }), reason: "ended" });
    expect(peer.closed).toBe(true);
    expect(track.stopped).toBe(true);
    expect(phase()).toBe("idle");
  });

  it("ignores signalling for a call it does not know", async () => {
    await onCallOffer({ callId: "ghost", from, sdp: "x" });
    await onCallCandidate({ callId: "ghost", from, candidate: null });
    await onCallAnswer({ callId: "ghost", from, sdp: "x" });
    expect(sent("call.answer")).toEqual([]);
  });
});
