import { useEffect, useRef, useState } from "react";
import { useCustomerCallStore } from "../model/store";
import "./customer-call.css";

function CallIcon({ kind }: { kind: "shield" | "close" | "mic" | "muted" | "keypad" | "speaker" | "end" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === "shield" && <path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z" />}
      {kind === "close" && <path d="m6 6 12 12M18 6 6 18" />}
      {(kind === "mic" || kind === "muted") && (
        <>
          <rect x="9" y="3" width="6" height="12" rx="3" />
          <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3" />
          {kind === "muted" && <path d="m3 3 18 18" />}
        </>
      )}
      {kind === "keypad" &&
        [5, 12, 19].flatMap((x) =>
          [5, 12, 19].map((y) => <circle key={x + "-" + y} cx={x} cy={y} r="1.25" fill="currentColor" stroke="none" />),
        )}
      {kind === "speaker" && (
        <>
          <path d="m11 4-6 5H2v6h3l6 5V4ZM16 8a6 6 0 0 1 0 8M20 4a12 12 0 0 1 0 16" />
        </>
      )}
      {kind === "end" && <path d="M2 13c5-7 15-7 20 0l-3 4-4-3v-3a15 15 0 0 0-6 0v3l-4 3-3-4Z" />}
    </svg>
  );
}

export default function CustomerCallDialog() {
  const { customer, end } = useCustomerCallStore();
  return customer ? <CallSession key={customer.id} customer={customer} onEnd={end} /> : null;
}

function CallSession({
  customer,
  onEnd,
}: {
  customer: NonNullable<ReturnType<typeof useCustomerCallStore.getState>["customer"]>;
  onEnd: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [elapsed, setElapsed] = useState(0);
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(true);
  const [keypad, setKeypad] = useState(false);
  const [digits, setDigits] = useState("");

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.showModal();
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => {
      window.clearInterval(timer);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  const time = [Math.floor(elapsed / 60), elapsed % 60].map((value) => String(value).padStart(2, "0")).join(":");

  return (
    <dialog
      ref={dialogRef}
      className="customer-call"
      aria-labelledby="customer-call-name"
      aria-describedby="customer-call-preview"
      onCancel={(event) => {
        event.preventDefault();
        onEnd();
      }}
    >
      <header className="customer-call-heading">
        <span>
          <CallIcon kind="shield" /> Secure customer call
        </span>
        <button className="customer-call-close" onClick={onEnd} aria-label="Close call">
          <CallIcon kind="close" />
        </button>
      </header>
      <div className="customer-call-avatar">
        <img src={customer.avatar} alt="" />
        <span />
      </div>
      <p className="customer-call-status">CONNECTED</p>
      <h2 id="customer-call-name">{customer.name}</h2>
      <p className="customer-call-details">
        {customer.application.product} · App ID {customer.application.appId}
      </p>
      <time className="customer-call-time" aria-label={`Call duration ${time}`}>
        {time}
      </time>
      <div className="customer-call-controls">
        <button aria-pressed={muted} onClick={() => setMuted(!muted)}>
          <span className={muted ? "selected" : ""}>
            <CallIcon kind={muted ? "muted" : "mic"} />
          </span>
          {muted ? "Unmute" : "Mute"}
        </button>
        <button
          aria-pressed={keypad}
          aria-expanded={keypad}
          aria-controls="customer-call-keypad"
          onClick={() => setKeypad(!keypad)}
        >
          <span className={keypad ? "selected" : ""}>
            <CallIcon kind="keypad" />
          </span>
          Keypad
        </button>
        <button aria-pressed={speaker} onClick={() => setSpeaker(!speaker)}>
          <span className={speaker ? "selected" : ""}>
            <CallIcon kind="speaker" />
          </span>
          Speaker
        </button>
      </div>
      {keypad && (
        <div id="customer-call-keypad" className="customer-call-keypad">
          <output aria-live="polite" aria-label="Dialed digits">
            {digits || "Enter a number"}
          </output>
          <div>
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"].map((digit) => (
              <button key={digit} onClick={() => setDigits((current) => current + digit)}>
                {digit}
              </button>
            ))}
          </div>
          <button onClick={() => setDigits((current) => current.slice(0, -1))} disabled={!digits}>
            Delete
          </button>
        </div>
      )}
      <button className="customer-call-end" onClick={onEnd}>
        <CallIcon kind="end" /> End call
      </button>
      <footer className="customer-call-footer">
        <p id="customer-call-preview">
          <span /> Call preview
        </p>
        <p>Live calling is not connected yet.</p>
      </footer>
    </dialog>
  );
}
