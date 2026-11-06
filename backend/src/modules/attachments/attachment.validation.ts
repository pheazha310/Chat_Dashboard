import { BadRequestError } from "@shared/errors/AppError.js";

export type AttachmentKind = "IMAGE" | "DOCUMENT" | "AUDIO" | "VIDEO";

const MB = 1024 * 1024;

interface Rule {
  kind: AttachmentKind;
  extensions: string[];
  maxBytes: number;
  /** Checks the file's first bytes, so a renamed file cannot pass for something else. */
  signature: (head: Buffer) => boolean;
}

const startsWith = (head: Buffer, bytes: number[], offset = 0) =>
  head.length >= offset + bytes.length && bytes.every((byte, i) => head[offset + i] === byte);
const ascii = (head: Buffer, text: string, offset = 0) =>
  head.length >= offset + text.length && head.toString("latin1", offset, offset + text.length) === text;

const jpeg = (h: Buffer) => startsWith(h, [0xff, 0xd8, 0xff]);
const png = (h: Buffer) => startsWith(h, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const gif = (h: Buffer) => ascii(h, "GIF87a") || ascii(h, "GIF89a");
const webp = (h: Buffer) => ascii(h, "RIFF") && ascii(h, "WEBP", 8);
const pdf = (h: Buffer) => ascii(h, "%PDF-");
const zip = (h: Buffer) => startsWith(h, [0x50, 0x4b, 0x03, 0x04]);
const ole = (h: Buffer) => startsWith(h, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ebml = (h: Buffer) => startsWith(h, [0x1a, 0x45, 0xdf, 0xa3]);
const isoBmff = (h: Buffer) => ascii(h, "ftyp", 4);
const ogg = (h: Buffer) => ascii(h, "OggS");
const wav = (h: Buffer) => ascii(h, "RIFF") && ascii(h, "WAVE", 8);
const mp3 = (h: Buffer) => ascii(h, "ID3") || (h.length >= 2 && h[0] === 0xff && ((h[1] ?? 0) & 0xe0) === 0xe0);
const plainText = (h: Buffer) => !h.subarray(0, 8192).includes(0);

/**
 * Allowed types, keyed by MIME type. Anything else is refused: no SVG, HTML, scripts or executables, which a browser
 * could run when opened. Extensions must match the type, and the content must match its signature.
 */
const RULES: Record<string, Rule> = {
  "image/jpeg": { kind: "IMAGE", extensions: ["jpg", "jpeg"], maxBytes: 10 * MB, signature: jpeg },
  "image/png": { kind: "IMAGE", extensions: ["png"], maxBytes: 10 * MB, signature: png },
  "image/gif": { kind: "IMAGE", extensions: ["gif"], maxBytes: 10 * MB, signature: gif },
  "image/webp": { kind: "IMAGE", extensions: ["webp"], maxBytes: 10 * MB, signature: webp },
  "application/pdf": { kind: "DOCUMENT", extensions: ["pdf"], maxBytes: 25 * MB, signature: pdf },
  "text/plain": { kind: "DOCUMENT", extensions: ["txt"], maxBytes: 5 * MB, signature: plainText },
  "text/csv": { kind: "DOCUMENT", extensions: ["csv"], maxBytes: 5 * MB, signature: plainText },
  "application/msword": { kind: "DOCUMENT", extensions: ["doc"], maxBytes: 25 * MB, signature: ole },
  "application/vnd.ms-excel": { kind: "DOCUMENT", extensions: ["xls"], maxBytes: 25 * MB, signature: ole },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    kind: "DOCUMENT",
    extensions: ["docx"],
    maxBytes: 25 * MB,
    signature: zip,
  },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
    kind: "DOCUMENT",
    extensions: ["xlsx"],
    maxBytes: 25 * MB,
    signature: zip,
  },
  "audio/mpeg": { kind: "AUDIO", extensions: ["mp3"], maxBytes: 25 * MB, signature: mp3 },
  "audio/ogg": { kind: "AUDIO", extensions: ["ogg", "oga", "opus"], maxBytes: 25 * MB, signature: ogg },
  "audio/wav": { kind: "AUDIO", extensions: ["wav"], maxBytes: 25 * MB, signature: wav },
  "audio/webm": { kind: "AUDIO", extensions: ["webm", "weba"], maxBytes: 25 * MB, signature: ebml },
  "audio/mp4": { kind: "AUDIO", extensions: ["m4a", "mp4"], maxBytes: 25 * MB, signature: isoBmff },
  "video/mp4": { kind: "VIDEO", extensions: ["mp4", "m4v"], maxBytes: 25 * MB, signature: isoBmff },
  "video/webm": { kind: "VIDEO", extensions: ["webm"], maxBytes: 25 * MB, signature: ebml },
  "video/quicktime": { kind: "VIDEO", extensions: ["mov"], maxBytes: 25 * MB, signature: isoBmff },
};

/** Browsers and recorders send several names for the same type. */
const ALIASES: Record<string, string> = {
  "image/jpg": "image/jpeg",
  "audio/x-wav": "audio/wav",
  "audio/wave": "audio/wav",
  "audio/x-m4a": "audio/mp4",
  "audio/mp3": "audio/mpeg",
  "audio/opus": "audio/ogg",
  "application/x-pdf": "application/pdf",
};

export const VOICE_MAX_BYTES = 10 * MB;
export const MAX_FILE_NAME = 255;

export interface ValidatedFile {
  fileName: string;
  mimeType: string;
  extension: string;
  kind: AttachmentKind;
}

/** Strips any path and control characters from the name the client sent. The name is only a label; it never decides where the file is stored. */
export function cleanFileName(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return Array.from(cleaned).slice(0, MAX_FILE_NAME).join("");
}

/**
 * Accepts a file only if its declared type is allowed, its extension fits that type, its size is within the limit
 * for the type, and its first bytes look like that type. `voice` additionally requires audio.
 */
export function validateFile(
  file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  options: { voice?: boolean } = {},
): ValidatedFile {
  const fileName = cleanFileName(file.originalname);
  if (!fileName) throw new BadRequestError("The file needs a name");
  // "audio/webm;codecs=opus" -> "audio/webm"
  const declared = (file.mimetype.split(";")[0] ?? "").trim().toLowerCase();
  const mimeType = ALIASES[declared] ?? declared;
  const rule = RULES[mimeType];
  if (!rule) throw new BadRequestError(`File type ${declared || "unknown"} is not allowed`);

  const extension = (fileName.includes(".") ? (fileName.split(".").pop() ?? "") : "").toLowerCase();
  if (!rule.extensions.includes(extension)) {
    throw new BadRequestError(`The extension .${extension || "(none)"} does not match ${mimeType}`);
  }
  if (options.voice && rule.kind !== "AUDIO") throw new BadRequestError("A voice message must be an audio recording");

  if (file.size === 0) throw new BadRequestError("The file is empty");
  const limit = options.voice ? Math.min(rule.maxBytes, VOICE_MAX_BYTES) : rule.maxBytes;
  if (file.size > limit) {
    throw new BadRequestError(`The file is too large (limit ${Math.floor(limit / MB)} MB for this type)`);
  }
  if (!rule.signature(file.buffer.subarray(0, 8192))) {
    throw new BadRequestError("The file content does not match its type");
  }
  return { fileName, mimeType, extension, kind: rule.kind };
}

/** The message type for a file sent on its own. */
export const messageTypeFor = (kind: AttachmentKind, voice: boolean) =>
  voice ? "VOICE" : kind === "DOCUMENT" ? "FILE" : kind;

/** Types a browser may display inside the page; everything else is always a download. */
export const INLINE_SAFE = new Set(["IMAGE", "AUDIO", "VIDEO"]);
export const kindOf = (mimeType: string): AttachmentKind => RULES[mimeType]?.kind ?? "DOCUMENT";
