import { afterEach, describe, expect, it, vi } from "vitest";

// env.ts loads backend/.env through dotenv; keep the developer's file out so each test sees only what it stubs.
vi.mock("dotenv/config", () => ({}));

/** Imports env.ts afresh with these variables (it parses process.env once, at import). */
async function loadEnv(vars: Record<string, string | undefined>) {
  vi.resetModules();
  vi.stubEnv("DATABASE_URL", "postgresql://localhost/chat_test");
  for (const [name, value] of Object.entries(vars)) vi.stubEnv(name, value);
  return (await import("../env.js")).env;
}

const noS3 = { S3_BUCKET: undefined, S3_REGION: undefined, S3_ENDPOINT: undefined, S3_FORCE_PATH_STYLE: undefined };

afterEach(() => vi.unstubAllEnvs());

describe("storage settings", () => {
  it("defaults to the local driver, which needs no S3 settings", async () => {
    const env = await loadEnv({ ...noS3, STORAGE_DRIVER: undefined });

    expect(env.STORAGE_DRIVER).toBe("local");
  });

  it("refuses to start the s3 driver without a bucket and region", async () => {
    await expect(loadEnv({ ...noS3, STORAGE_DRIVER: "s3", S3_REGION: "ap-southeast-1" })).rejects.toThrow("S3_BUCKET");
    await expect(loadEnv({ ...noS3, STORAGE_DRIVER: "s3", S3_BUCKET: "chat-files" })).rejects.toThrow("S3_REGION");
  });

  it("reads the s3 settings, with path-style addressing off unless asked for", async () => {
    const aws = await loadEnv({ ...noS3, STORAGE_DRIVER: "s3", S3_BUCKET: "chat-files", S3_REGION: "ap-southeast-1" });
    expect(aws).toMatchObject({ STORAGE_DRIVER: "s3", S3_BUCKET: "chat-files", S3_FORCE_PATH_STYLE: false });

    const minio = await loadEnv({
      ...noS3,
      STORAGE_DRIVER: "s3",
      S3_BUCKET: "chat-files",
      S3_REGION: "us-east-1",
      S3_ENDPOINT: "http://localhost:9000",
      S3_FORCE_PATH_STYLE: "true",
    });
    expect(minio).toMatchObject({ S3_ENDPOINT: "http://localhost:9000", S3_FORCE_PATH_STYLE: true });
  });
});
