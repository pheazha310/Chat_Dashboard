import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { fromPartial } from "@total-typescript/shoehorn";
import { Readable } from "node:stream";
import { text } from "node:stream/consumers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { S3Storage } from "../s3-storage.js";

const send = vi.fn();
const storage = new S3Storage(fromPartial<S3Client>({ send }), "chat-files");
const key = "conversations/c1/f1.png";

/** The command `send` received on its nth call. */
const sent = (n = 0) => send.mock.calls[n]?.[0] as { constructor: unknown; input: Record<string, unknown> };

beforeEach(() => send.mockReset());

describe("S3Storage", () => {
  it("puts the bytes under the key in the bucket", async () => {
    send.mockResolvedValue({});
    await storage.put(key, Buffer.from("png-bytes"));

    expect(sent().constructor).toBe(PutObjectCommand);
    expect(sent().input).toMatchObject({ Bucket: "chat-files", Key: key, Body: Buffer.from("png-bytes") });
  });

  it("reports the object's size", async () => {
    send.mockResolvedValue({ ContentLength: 2048 });

    expect(await storage.stat(key)).toEqual({ size: 2048 });
    expect(sent().constructor).toBe(HeadObjectCommand);
    expect(sent().input).toEqual({ Bucket: "chat-files", Key: key });
  });

  it("reports a missing object as null, and rethrows other failures", async () => {
    send.mockRejectedValueOnce(Object.assign(new Error("NotFound"), { $metadata: { httpStatusCode: 404 } }));
    expect(await storage.stat(key)).toBeNull();

    send.mockRejectedValueOnce(Object.assign(new Error("AccessDenied"), { $metadata: { httpStatusCode: 403 } }));
    await expect(storage.stat(key)).rejects.toThrow("AccessDenied");
  });

  it("streams the whole object", async () => {
    send.mockResolvedValue({ Body: Readable.from(["hello ", "world"]) });

    expect(await text(storage.open(key))).toBe("hello world");
    expect(sent().constructor).toBe(GetObjectCommand);
    expect(sent().input).toEqual({ Bucket: "chat-files", Key: key });
  });

  it("asks for an inclusive byte range", async () => {
    send.mockResolvedValue({ Body: Readable.from(["llo"]) });

    expect(await text(storage.open(key, { start: 2, end: 4 }))).toBe("llo");
    expect(sent().input).toEqual({ Bucket: "chat-files", Key: key, Range: "bytes=2-4" });
  });

  it("fails the stream when the object cannot be fetched", async () => {
    send.mockRejectedValueOnce(new Error("SlowDown"));

    await expect(text(storage.open(key))).rejects.toThrow("SlowDown");
  });

  it("deletes the object", async () => {
    send.mockResolvedValue({});
    await storage.delete(key);

    expect(sent().constructor).toBe(DeleteObjectCommand);
    expect(sent().input).toEqual({ Bucket: "chat-files", Key: key });
  });
});
