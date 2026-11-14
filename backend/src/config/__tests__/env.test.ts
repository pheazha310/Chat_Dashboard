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

const DEV_BASE = "https://api-dev.los.delightech.asia/api/v1";
const DEV_JWKS = `${DEV_BASE}/guest/.well-known/jwks.json`;
const UAT_JWKS = "https://api-uat.los.delightech.asia/api/v1/guest/.well-known/jwks.json";
const noLos = {
  LOS_ISSUER: undefined,
  LOS_JWKS_URL: undefined,
  LOS_PUBLIC_KEY: undefined,
  LOS_BASE_URL: undefined,
  LOS_HANDOFF_TOKEN_MAX_AGE: undefined,
  LOS_WEB_ORIGIN: undefined,
  CHAT_WEB_ORIGIN: undefined,
  LOS_SERVICE_API_KEY: undefined,
  LOS_SERVICE_ALLOWED_IPS: undefined,
};

describe("LOS settings", () => {
  it("accepts a Dev set whose JWKS and API are on the same LOS host", async () => {
    const env = await loadEnv({ ...noLos, LOS_ISSUER: "los-backend", LOS_JWKS_URL: DEV_JWKS, LOS_BASE_URL: DEV_BASE });

    expect(env).toMatchObject({ LOS_BASE_URL: DEV_BASE, LOS_HANDOFF_TOKEN_MAX_AGE: 120 });
  });

  it("refuses a Staging JWKS with the Dev API (each environment signs with its own key)", async () => {
    await expect(
      loadEnv({ ...noLos, LOS_ISSUER: "los-backend", LOS_JWKS_URL: UAT_JWKS, LOS_BASE_URL: DEV_BASE }),
    ).rejects.toThrow("same host");
  });

  it("limits the hand-off token age to a sensible range", async () => {
    await expect(loadEnv({ ...noLos, LOS_HANDOFF_TOKEN_MAX_AGE: "0" })).rejects.toThrow("LOS_HANDOFF_TOKEN_MAX_AGE");
    await expect(loadEnv({ ...noLos, LOS_HANDOFF_TOKEN_MAX_AGE: "3600" })).rejects.toThrow("LOS_HANDOFF_TOKEN_MAX_AGE");
    expect((await loadEnv({ ...noLos, LOS_HANDOFF_TOKEN_MAX_AGE: "300" })).LOS_HANDOFF_TOKEN_MAX_AGE).toBe(300);
  });

  it("takes web origins as bare origins, never a path or a wildcard", async () => {
    const env = await loadEnv({ ...noLos, LOS_WEB_ORIGIN: "https://cms-uat.delightech.asia/" });
    expect(env.LOS_WEB_ORIGIN).toBe("https://cms-uat.delightech.asia");

    await expect(loadEnv({ ...noLos, LOS_WEB_ORIGIN: "*" })).rejects.toThrow("LOS_WEB_ORIGIN");
    await expect(loadEnv({ ...noLos, CHAT_WEB_ORIGIN: "https://chat.example.com/app" })).rejects.toThrow(
      "CHAT_WEB_ORIGIN",
    );
  });

  it("keeps the service credentials unset by default (LOS has not provided them yet)", async () => {
    const env = await loadEnv(noLos);

    expect(env.LOS_SERVICE_API_KEY).toBeUndefined();
    expect(env.LOS_SERVICE_ALLOWED_IPS).toBe("");
  });
});

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

describe("S3 credentials", () => {
  const s3 = { ...noS3, S3_ACCESS_KEY: undefined, S3_SECRET_KEY: undefined };

  it("reads an explicit key pair for an S3-compatible store", async () => {
    const env = await loadEnv({ ...s3, S3_ACCESS_KEY: "access", S3_SECRET_KEY: "secret" });

    expect(env).toMatchObject({ S3_ACCESS_KEY: "access", S3_SECRET_KEY: "secret" });
  });

  it("accepts neither (the standard AWS chain is used then)", async () => {
    const env = await loadEnv(s3);

    expect(env.S3_ACCESS_KEY).toBeUndefined();
    expect(env.S3_SECRET_KEY).toBeUndefined();
  });

  it("refuses half a pair", async () => {
    await expect(loadEnv({ ...s3, S3_ACCESS_KEY: "access" })).rejects.toThrow("S3_SECRET_KEY");
    await expect(loadEnv({ ...s3, S3_SECRET_KEY: "secret" })).rejects.toThrow("S3_ACCESS_KEY");
  });
});
