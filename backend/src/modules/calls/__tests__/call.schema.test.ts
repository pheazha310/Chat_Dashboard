import { describe, expect, it } from "vitest";
import { uid } from "../../../__tests__/support/ids.js";
import { candidateSignal, MAX_SDP_LENGTH, sdpSignal, startCallBody } from "../call.schema.js";

describe("call schemas", () => {
  it("starts an audio call unless told otherwise, and refuses unknown types", () => {
    expect(startCallBody.parse({}).callType).toBe("AUDIO");
    expect(startCallBody.parse({ callType: "VIDEO" }).callType).toBe("VIDEO");
    expect(startCallBody.safeParse({ callType: "FAX" }).success).toBe(false);
  });

  it("limits the size of a session description and needs a valid call id", () => {
    expect(sdpSignal.safeParse({ callId: uid(1), sdp: "v=0" }).success).toBe(true);
    expect(sdpSignal.safeParse({ callId: uid(1), sdp: "" }).success).toBe(false);
    expect(sdpSignal.safeParse({ callId: uid(1), sdp: "x".repeat(MAX_SDP_LENGTH + 1) }).success).toBe(false);
    expect(sdpSignal.safeParse({ callId: "nope", sdp: "v=0" }).success).toBe(false);
  });

  it("accepts an ICE candidate, the end-of-candidates marker, and nothing malformed", () => {
    const candidate = { candidate: "candidate:1 1 UDP 1 10.0.0.1 9 typ host", sdpMid: "0", sdpMLineIndex: 0 };
    expect(candidateSignal.safeParse({ callId: uid(1), candidate }).success).toBe(true);
    expect(candidateSignal.safeParse({ callId: uid(1), candidate: null }).success).toBe(true);
    expect(candidateSignal.safeParse({ callId: uid(1), candidate: { candidate: "x".repeat(2001) } }).success).toBe(
      false,
    );
    expect(candidateSignal.safeParse({ callId: uid(1), candidate: { sdpMLineIndex: 1 } }).success).toBe(false);
    expect(candidateSignal.safeParse({ callId: uid(1) }).success).toBe(false);
  });
});
