import { describe, expect, it } from "vitest";
import { BadRequestError } from "@shared/errors/AppError.js";
import { cleanFileName, messageTypeFor, validateFile, VOICE_MAX_BYTES } from "../attachment.validation.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const file = (name: string, mimetype: string, buffer: Buffer, size = buffer.length) => ({
  originalname: name,
  mimetype,
  size,
  buffer,
});

describe("validateFile", () => {
  it("accepts a file whose type, extension and content agree", () => {
    expect(validateFile(file("scan.PNG", "image/png", PNG))).toEqual({
      fileName: "scan.PNG",
      mimeType: "image/png",
      extension: "png",
      kind: "IMAGE",
    });
    expect(validateFile(file("a.pdf", "application/pdf", Buffer.from("%PDF-1.7 ...")))).toMatchObject({
      kind: "DOCUMENT",
    });
    expect(validateFile(file("x.jpg", "image/jpg", Buffer.from([0xff, 0xd8, 0xff, 0xe0])))).toMatchObject({
      mimeType: "image/jpeg",
    });
  });

  it("refuses types that could run in a browser or on a machine", () => {
    for (const [name, type] of [
      ["x.svg", "image/svg+xml"],
      ["x.html", "text/html"],
      ["x.js", "application/javascript"],
      ["x.exe", "application/x-msdownload"],
      ["x.zip", "application/zip"],
      ["x", ""],
    ] as const) {
      expect(() => validateFile(file(name, type, Buffer.from("<script>")))).toThrow(BadRequestError);
    }
  });

  it("refuses a mismatched extension or content", () => {
    expect(() => validateFile(file("photo.jpg", "image/png", PNG))).toThrow(/extension/);
    expect(() => validateFile(file("photo.png", "image/png", Buffer.from("<html><script>alert(1)</script>")))).toThrow(
      /content does not match/,
    );
    expect(() => validateFile(file("report", "application/pdf", Buffer.from("%PDF-1")))).toThrow(/extension/);
  });

  it("refuses text files that are really binary", () => {
    expect(() => validateFile(file("a.txt", "text/plain", Buffer.from([65, 0, 66])))).toThrow(BadRequestError);
    expect(validateFile(file("a.csv", "text/csv", Buffer.from("a,b\n1,2")))).toMatchObject({ kind: "DOCUMENT" });
  });

  it("enforces size per type", () => {
    expect(() => validateFile(file("a.png", "image/png", PNG, 10 * 1024 * 1024 + 1))).toThrow(/too large/);
    expect(() => validateFile(file("a.png", "image/png", Buffer.alloc(0), 0))).toThrow(/empty/);
  });

  it("recognises recorder output, ignoring codec parameters", () => {
    const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0]);
    expect(validateFile(file("voice.webm", "audio/webm;codecs=opus", webm), { voice: true })).toMatchObject({
      mimeType: "audio/webm",
      kind: "AUDIO",
    });
    expect(
      validateFile(file("voice.m4a", "audio/mp4", Buffer.from("\0\0\0\x20ftypM4A ", "latin1")), { voice: true }),
    ).toBeTruthy();
    expect(validateFile(file("v.ogg", "audio/ogg", Buffer.from("OggS\0\x02")), { voice: true })).toBeTruthy();
  });

  it("requires audio, and a smaller size, for voice messages", () => {
    expect(() => validateFile(file("a.png", "image/png", PNG), { voice: true })).toThrow(/audio/);
    const wav = Buffer.from("RIFF\0\0\0\0WAVE");
    expect(() => validateFile(file("a.wav", "audio/wav", wav, VOICE_MAX_BYTES + 1), { voice: true })).toThrow(
      /too large/,
    );
    expect(validateFile(file("a.wav", "audio/wav", wav, VOICE_MAX_BYTES), { voice: true })).toBeTruthy();
  });
});

describe("helpers", () => {
  it("strips paths and control characters from file names", () => {
    expect(cleanFileName("../../etc/passwd")).toBe("passwd");
    expect(cleanFileName("C:\\Users\\me\\scan.pdf")).toBe("scan.pdf");
    expect(cleanFileName("a\u0000b\nc.png")).toBe("abc.png");
    expect(Array.from(cleanFileName("x".repeat(400))).length).toBe(255);
  });

  it("maps a file kind to a message type", () => {
    expect(messageTypeFor("IMAGE", false)).toBe("IMAGE");
    expect(messageTypeFor("DOCUMENT", false)).toBe("FILE");
    expect(messageTypeFor("AUDIO", true)).toBe("VOICE");
  });
});
