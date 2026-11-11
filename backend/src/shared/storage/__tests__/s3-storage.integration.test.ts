import { CreateBucketCommand, HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { text } from "node:stream/consumers";
import { beforeAll, describe, expect, it } from "vitest";
import { S3Storage } from "../s3-storage.js";

/**
 * Against a real S3-compatible store, e.g. Adobe S3Mock (accepts any credentials):
 *   docker run -d --rm --name chat-s3-test -p 9090:9090 adobe/s3mock
 *   TEST_S3_ENDPOINT=http://localhost:9090 TEST_S3_BUCKET=chat-test \
 *   AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test pnpm --filter @chat-dashboard/backend test
 * Use a throwaway bucket: it is created when missing, and each run writes under its own random prefix.
 * TEST_S3_REGION is optional (default us-east-1).
 */
const endpoint = process.env.TEST_S3_ENDPOINT;
const bucket = process.env.TEST_S3_BUCKET;

describe.skipIf(!endpoint || !bucket)("S3Storage against a real store (needs TEST_S3_ENDPOINT, TEST_S3_BUCKET)", () => {
  const client = new S3Client({ region: process.env.TEST_S3_REGION ?? "us-east-1", endpoint, forcePathStyle: true });
  const storage = new S3Storage(client, bucket as string);
  const key = `test-runs/${randomUUID()}/voice.webm`;

  beforeAll(async () => {
    await client
      .send(new HeadBucketCommand({ Bucket: bucket }))
      .catch(() => client.send(new CreateBucketCommand({ Bucket: bucket })));
  });

  it("stores, measures, streams a range of and deletes an object", async () => {
    expect(await storage.stat(key)).toBeNull();

    await storage.put(key, Buffer.from("0123456789"));
    expect(await storage.stat(key)).toEqual({ size: 10 });
    expect(await text(storage.open(key))).toBe("0123456789");
    expect(await text(storage.open(key, { start: 2, end: 5 }))).toBe("2345");

    await storage.delete(key);
    expect(await storage.stat(key)).toBeNull();
    await storage.delete(key); // already gone: not an error
  });

  it("fails the stream for a missing object", async () => {
    await expect(text(storage.open(`${key}.missing`))).rejects.toThrow();
  });
});
