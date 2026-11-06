import { useEffect, useRef, useState } from "react";
import {
  acceptIncomingCall,
  declineIncomingCall,
  endLiveCall,
  toggleMute,
  useLiveCallStore,
  type Phase,
} from "../model/live-call";
import "./customer-call.css";

const STATUS: Record<Exclude<Phase, "idle" | "active">, string> = {
  calling: "RINGING…",
  incoming: "INCOMING CALL",
  connecting: "CONNECTING…",
};

const clock = (seconds: number) =>
  [Math.floor(seconds / 60), seconds % 60].map((value) => String(value).padStart(2, "0")).join(":");

/** The real call with a customer. Shown only against the real backend; the mock transport keeps the old preview. */
export default function LiveCallDialog() {
  const { phase, name, muted, remoteStream, connectedAt } = useLiveCallStore();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [elapsed, setElapsed] = useState(0);
  const open = phase !== "idle";

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.srcObject = remoteStream;
  }, [remoteStream]);

  useEffect(() => {
    if (connectedAt === null) return setElapsed(0);
    const tick = () => setElapsed(Math.floor((Date.now() - connectedAt) / 1000));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [connectedAt]);

  if (!open) return <dialog ref={dialogRef} className="customer-call" hidden />;

  return (
    <dialog
      ref={dialogRef}
      className="customer-call"
      aria-labelledby="live-call-name"
      onCancel={(event) => {
        event.preventDefault();
        if (phase === "incoming") void declineIncomingCall();
        else void endLiveCall();
      }}
    >
      <audio ref={audioRef} autoPlay />
      <p className="customer-call-status">{phase === "active" ? "CONNECTED" : STATUS[phase]}</p>
      <h2 id="live-call-name">{name}</h2>
      {phase === "active" && (
        <time className="customer-call-time" aria-label={`Call duration ${clock(elapsed)}`}>
          {clock(elapsed)}
        </time>
      )}
      {phase === "incoming" ? (
        <div className="customer-call-controls">
          <button onClick={() => void acceptIncomingCall()} autoFocus>
            Answer
          </button>
          <button onClick={() => void declineIncomingCall()}>Decline</button>
        </div>
      ) : (
        <>
          {(phase === "active" || phase === "connecting") && (
            <div className="customer-call-controls">
              <button aria-pressed={muted} onClick={toggleMute}>
                {muted ? "Unmute" : "Mute"}
              </button>
            </div>
          )}
          <button className="customer-call-end" onClick={() => void endLiveCall()} autoFocus>
            {phase === "calling" ? "Cancel" : "End call"}
          </button>
        </>
      )}
    </dialog>
  );
}
