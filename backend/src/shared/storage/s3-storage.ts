import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { PassThrough, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Storage } from "./storage.js";

/** Files in one bucket of S3 or an S3-compatible store (MinIO, R2, ...). For several API servers. */
export class S3Storage implements Storage {
  constructor(
    private readonly client: Pick<S3Client, "send">,
    private readonly bucket: string,
  ) {}

  async put(key: string, data: Buffer): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data }));
  }

  async stat(key: string) {
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: head.ContentLength ?? 0 };
    } catch (error) {
      if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null;
      throw error;
    }
  }

  /**
   * `Storage.open` returns a stream at once, but S3 answers asynchronously: the object is piped into the returned
   * stream when it arrives, and a failed request fails that stream (the caller already handles stream errors).
   * Destroying the returned stream (client gone) also closes the S3 response.
   */
  open(key: string, range?: { start: number; end: number }): Readable {
    const out = new PassThrough();
    const input = { Bucket: this.bucket, Key: key, ...(range && { Range: `bytes=${range.start}-${range.end}` }) };
    this.client
      .send(new GetObjectCommand(input))
      .then((object) => pipeline(object.Body as Readable, out))
      .catch((error: unknown) => out.destroy(error as Error));
    return out;
  }

  /** S3 already treats deleting a missing key as success. */
  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
