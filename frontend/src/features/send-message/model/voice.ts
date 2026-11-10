import { notify } from "@/shared/ui";
import { sendVoice } from "./files";
import { useComposerStore } from "./store";

/** Formats MediaRecorder can produce, best first. The server accepts WebM, Ogg and MP4 audio. */
const FORMATS = [
  { mime: "audio/webm;codecs=opus", extension: "webm" },
  { mime: "audio/webm", extension: "webm" },
  { mime: "audio/ogg;codecs=opus", extension: "ogg" },
  { mime: "audio/mp4", extension: "m4a" },
];
export const MAX_RECORDING_MS = 5 * 60_000;

type Session = {
  recorder: MediaRecorder;
  stream: MediaStream;
  chunks: Blob[];
  startedAt: number;
  timer: number;
  send: boolean;
};
let session: (Session & { conversationId: string }) | null = null;

export const canRecordVoice = () =>
  typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";

/** Asks for the microphone and starts recording for this conversation. */
export async function startVoiceRecording(conversationId: string) {
  if (session) return;
  if (!canRecordVoice()) return void notify("Voice recording is not supported in this browser");
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    return void notify("Microphone access was denied");
  }
  const format = FORMATS.find((f) => MediaRecorder.isTypeSupported(f.mime));
  const recorder = new MediaRecorder(stream, format ? { mimeType: format.mime } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => event.data.size > 0 && chunks.push(event.data);
  recorder.onstop = () => {
    const finished = session;
    session = null;
    window.clearTimeout(finished?.timer);
    stream.getTracks().forEach((track) => track.stop());
    useComposerStore.setState({ recording: false, recordingSince: null });
    if (!finished?.send || chunks.length === 0) return;
    const type = (recorder.mimeType || format?.mime || "audio/webm").split(";")[0] ?? "audio/webm";
    const extension = FORMATS.find((f) => f.mime.startsWith(type))?.extension ?? "webm";
    const file = new File(chunks, `voice-message.${extension}`, { type: recorder.mimeType || type });
    sendVoice(finished.conversationId, file, Date.now() - finished.startedAt);
  };

  const timer = window.setTimeout(() => stopVoiceRecording(true), MAX_RECORDING_MS);
  session = { recorder, stream, chunks, startedAt: Date.now(), timer, send: true, conversationId };
  recorder.start();
  useComposerStore.setState({ recording: true, recordingSince: Date.now() });
}

/** Ends the recording; `send` false throws it away. */
export function stopVoiceRecording(send: boolean) {
  if (!session) return;
  session.send = send;
  if (session.recorder.state !== "inactive") session.recorder.stop();
}
