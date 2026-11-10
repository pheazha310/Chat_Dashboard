/**
 * A stand-in for LOS when trying "sign in with LOS" locally: a key pair kept in `backend/.los-dev/` (git-ignored) and
 * tokens signed with it in the shape LOS uses (docs/api-auth.md, "Sign in with LOS"). Development only: the script that
 * uses it refuses NODE_ENV=production, and the server trusts these tokens only if you put the printed public key in
 * your own `.env`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { exportPKCS8, exportSPKI, generateKeyPair, importPKCS8, SignJWT } from "jose";

/** The issuer used when `.env` has no LOS_ISSUER yet. */
export const DEV_LOS_ISSUER = "http://localhost/los-dev";

export interface DevLosKeys {
  privateKey: CryptoKey;
  /** SPKI PEM, what LOS_PUBLIC_KEY expects. */
  publicPem: string;
}

/** Reads the dev key pair from `dir`, creating it on first use. */
export async function loadOrCreateDevKeys(dir: string): Promise<DevLosKeys> {
  const privatePath = join(dir, "private.pem");
  const publicPath = join(dir, "public.pem");
  if (existsSync(privatePath) && existsSync(publicPath)) {
    return {
      privateKey: await importPKCS8(readFileSync(privatePath, "utf8"), "RS256"),
      publicPem: readFileSync(publicPath, "utf8"),
    };
  }
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  const publicPem = await exportSPKI(publicKey);
  mkdirSync(dir, { recursive: true });
  writeFileSync(privatePath, await exportPKCS8(privateKey), { mode: 0o600 });
  writeFileSync(publicPath, publicPem);
  return { privateKey, publicPem };
}

/** The `.env` lines that make the server trust the dev key (the PEM on one line, with `\n` escapes). */
export const devEnvLines = (issuer: string, publicPem: string) => [
  `LOS_ISSUER=${issuer}`,
  `LOS_PUBLIC_KEY="${publicPem.trim().replace(/\n/g, "\\n")}"`,
];

interface TokenSettings {
  issuer: string;
  audience: string;
  userId: number;
  username: string;
  /** Lifetime, e.g. "1h" or "10m". */
  expiresIn: string;
}

/** What the mobile app holds: an LOS customer access token. */
export const devCustomerToken = (key: CryptoKey, settings: TokenSettings) =>
  sign(key, settings, { type: "customer", tokenType: "access" });

/** What LOS hands the dashboard: a single-use staff hand-off token (a fresh `jti` each time). */
export const devHandoffToken = (key: CryptoKey, settings: TokenSettings & { tokenType: string; role: string }) =>
  sign(key, settings, { type: "staff", tokenType: settings.tokenType, role: settings.role });

const sign = (key: CryptoKey, settings: TokenSettings, claims: Record<string, string>) =>
  new SignJWT({ userId: settings.userId, username: settings.username, ...claims })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(settings.issuer)
    .setAudience(settings.audience)
    .setIssuedAt()
    .setExpirationTime(settings.expiresIn)
    .setJti(randomUUID())
    .sign(key);
