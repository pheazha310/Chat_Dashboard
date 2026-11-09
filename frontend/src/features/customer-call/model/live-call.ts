import { create } from "zustand";
import { useConversationStore } from "@/entities/conversation";
import {
  acceptCallRequest,
  cancelCallRequest,
  declineCallRequest,
  endCallRequest,
  getCallConfig,
  startCallRequest,
  type Call,
} from "@/shared/api/rest";
import { useSessionStore } from "@/shared/api/session";
import { wsClient, type ClientEventMap, type ServerEventMap } from "@/shared/api/ws";
import { notify } from "@/shared/ui";

/**
 * A real call with a customer (docs/api-calls.md). The server only keeps the call's record and passes session
 * descriptions along; the audio itself goes straight between the two browsers (WebRTC).
 *
 * idle -> calling (we rang, waiting) -> connecting (answered, negotiating) -> active (audio flowing)
 * idle -> incoming (a customer rings) -> connecting -> active
 */
export type Phase = "idle" | "calling" | "incoming" | "connecting" | "active";

type LiveCallState = {
  phase: Phase;
  call: Call | null;
  name: string;
  muted: boolean;
  remoteStream: MediaStream | null;
  /** When audio started flowing (ms since epoch), for the on-screen timer. */
  connectedAt: number | null;
};

const idle: LiveCallState = {
  phase: "idle",
  call: null,
  name: "",
  muted: false,
  remoteStream: null,
  connectedAt: null,
};
export const useLiveCallStore = create<LiveCallState>(() => idle);

/** The browser's WebRTC and microphone, behind an interface so tests can supply fakes. */
export interface Rtc {
  getMicrophone(): Promise<MediaStream>;
  createPeer(iceServers: RTCIceServer[]): RTCPeerConnection;
}
const browserRtc: Rtc = {
  getMicrophone: () => navigator.mediaDevices.getUserMedia({ audio: true, video: false }),
  createPeer: (iceServers) => new RTCPeerConnection({ iceServers }),
};
let rtc: Rtc = browserRtc;
export const setRtc = (next: Rtc | null) => void (rtc = next ?? browserRtc);

type Session = {
  callId: string;
  peer: RTCPeerConnection | null;
  stream: MediaStream | null;
  /** Candidates that arrived before the remote description; added once it is set. */
  pending: (RTCIceCandidateInit | null)[];
  remoteSet: boolean;
};
let session: Session | null = null;
/**
 * The customer can send its offer and candidates while we are still opening the microphone (the permission prompt
 * can take seconds). They wait here until the connection exists.
 */
let early: { callId: string; offer: string | null; candidates: (RTCIceCandidateInit | null)[] } | null = null;
const stash = (callId: string) => {
  if (useLiveCallStore.getState().call?.id !== callId) return null;
  if (early?.callId !== callId) early = { callId, offer: null, candidates: [] };
  return early;
};

const mine = () => useSessionStore.getState().userId;
const nameOf = (conversationId: string) => useConversationStore.getState().byId[conversationId]?.name ?? "Customer";
const failure = (error: unknown, fallback: string) => notify(error instanceof Error ? error.message : fallback);

function cleanup() {
  if (session) {
    session.peer?.close();
    session.stream?.getTracks().forEach((track) => track.stop());
  }
  session = null;
  early = null;
  useLiveCallStore.setState(idle);
}

/** Opens the microphone and the peer connection, wiring candidates and the remote audio. */
async function prepare(call: Call) {
  const config = await getCallConfig();
  const stream = await rtc.getMicrophone();
  const peer = rtc.createPeer(config.iceServers as RTCIceServer[]);
  session = { callId: call.id, peer, stream, pending: [], remoteSet: false };

  stream.getTracks().forEach((track) => peer.addTrack(track, stream));
  peer.onicecandidate = (event) => {
    const candidate = event.candidate ? event.candidate.toJSON() : null;
    wsClient.send("call.ice_candidate", {
      callId: call.id,
      candidate: candidate as ClientEventMap["call.ice_candidate"]["candidate"],
    });
  };
  peer.ontrack = (event) => {
    useLiveCallStore.setState({ remoteStream: event.streams[0] ?? new MediaStream([event.track]) });
  };
  peer.onconnectionstatechange = () => {
    if (!session || session.peer !== peer) return;
    if (peer.connectionState === "connected") {
      useLiveCallStore.setState({ phase: "active", connectedAt: Date.now() });
    } else if (peer.connectionState === "failed") {
      notify("The call connection failed");
      void endLiveCall();
    }
  };
  return peer;
}

/** Applies the remote description, then the candidates that were waiting for it. */
async function setRemote(peer: RTCPeerConnection, description: RTCSessionDescriptionInit) {
  await peer.setRemoteDescription(description);
  if (!session) return;
  session.remoteSet = true;
  const waiting = session.pending.splice(0);
  for (const candidate of waiting) await peer.addIceCandidate(candidate ?? undefined);
}

/** Rings the customer of this conversation. */
export async function startLiveCall(conversation: { id: string; name: string }) {
  if (useLiveCallStore.getState().phase !== "idle") return notify("You are already in a call");
  try {
    const call = await startCallRequest(conversation.id, "AUDIO");
    useLiveCallStore.setState({ ...idle, phase: "calling", call, name: conversation.name });
  } catch (error) {
    failure(error, "Could not start the call");
  }
}

/** Answers the customer's call that is ringing. */
export async function acceptIncomingCall() {
  const { call } = useLiveCallStore.getState();
  if (!call) return;
  try {
    const answered = await acceptCallRequest(call.id);
    useLiveCallStore.setState({ phase: "connecting", call: answered });
    await prepare(answered);
    const waiting = early;
    early = null;
    if (waiting?.callId === answered.id) {
      if (waiting.offer !== null)
        await onCallOffer({ callId: answered.id, from: { type: "CUSTOMER", id: "" }, sdp: waiting.offer });
      for (const candidate of waiting.candidates)
        await onCallCandidate({
          callId: answered.id,
          from: { type: "CUSTOMER", id: "" },
          candidate: candidate as never,
        });
    }
  } catch (error) {
    failure(error, "Could not answer the call");
    if (useLiveCallStore.getState().phase === "connecting") await endLiveCall();
    else cleanup();
  }
}

export async function declineIncomingCall() {
  const { call } = useLiveCallStore.getState();
  if (!call) return;
  cleanup();
  await declineCallRequest(call.id).catch((error) => failure(error, "Could not decline the call"));
}

/** Hangs up, or cancels while it is still ringing. */
export async function endLiveCall() {
  const { call, phase } = useLiveCallStore.getState();
  cleanup();
  if (!call) return;
  const request = phase === "calling" ? cancelCallRequest : endCallRequest;
  await request(call.id).catch(() => undefined); // already over on the server is fine
}

export function toggleMute() {
  const muted = !useLiveCallStore.getState().muted;
  session?.stream?.getAudioTracks().forEach((track) => (track.enabled = !muted));
  useLiveCallStore.setState({ muted });
}

// ─── server events ───────────────────────────────────────────────────────────

export function onCallIncoming({ call }: ServerEventMap["call.incoming"]) {
  if (call.initiatedBy.type !== "CUSTOMER" || useLiveCallStore.getState().phase !== "idle") return;
  useLiveCallStore.setState({ ...idle, phase: "incoming", call, name: nameOf(call.conversationId) });
}

/** The customer answered our call (we start the negotiation), or another window answered the one we were shown. */
export async function onCallAccepted({ call, by }: ServerEventMap["call.accepted"]) {
  const state = useLiveCallStore.getState();
  if (state.call?.id !== call.id) return;
  if (state.phase === "calling") {
    useLiveCallStore.setState({ phase: "connecting", call });
    try {
      const peer = await prepare(call);
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      wsClient.send("call.offer", { callId: call.id, sdp: offer.sdp ?? "" });
    } catch (error) {
      failure(error, "Could not set up the call");
      await endLiveCall();
    }
  } else if (state.phase === "incoming" && by.id !== mine()) {
    cleanup();
    notify("The call was answered by someone else");
  }
}

export async function onCallOffer({ callId, sdp }: ServerEventMap["call.offer"]) {
  if (!session) {
    const waiting = stash(callId);
    if (waiting) waiting.offer = sdp;
    return;
  }
  if (session.callId !== callId || !session.peer) return;
  try {
    await setRemote(session.peer, { type: "offer", sdp });
    const answer = await session.peer.createAnswer();
    await session.peer.setLocalDescription(answer);
    wsClient.send("call.answer", { callId, sdp: answer.sdp ?? "" });
  } catch (error) {
    failure(error, "Could not connect the call");
    await endLiveCall();
  }
}

export async function onCallAnswer({ callId, sdp }: ServerEventMap["call.answer"]) {
  if (!session || session.callId !== callId || !session.peer) return;
  try {
    await setRemote(session.peer, { type: "answer", sdp });
  } catch (error) {
    failure(error, "Could not connect the call");
    await endLiveCall();
  }
}

export async function onCallCandidate({ callId, candidate }: ServerEventMap["call.ice_candidate"]) {
  if (!session) {
    stash(callId)?.candidates.push(candidate);
    return;
  }
  if (session.callId !== callId || !session.peer) return;
  if (!session.remoteSet) return void session.pending.push(candidate);
  await session.peer.addIceCandidate(candidate ?? undefined).catch(() => undefined);
}

const WHY: Record<string, string> = {
  ended: "The call ended",
  cancelled: "The customer hung up before you answered",
  missed: "The call was not answered",
  timeout: "The call ended automatically",
};

/** The call is over for everyone (hung up, cancelled, missed). */
export function onCallEnded({ call, reason }: ServerEventMap["call.ended"]) {
  if (useLiveCallStore.getState().call?.id !== call.id) return;
  cleanup();
  notify(WHY[reason] ?? "The call ended");
}

export function onCallDeclined({ call }: ServerEventMap["call.declined"]) {
  const state = useLiveCallStore.getState();
  if (state.call?.id !== call.id) return;
  cleanup();
  notify(state.phase === "calling" ? "The customer declined the call" : "The call was declined");
}
