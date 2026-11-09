import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * Password hashing with Node's built-in scrypt (memory-hard, no native dependency). Stored as
 * `scrypt$<log2 N>$<r>$<p>$<salt base64>$<hash base64>` so the cost can be raised later: `needsRehash` reports
 * hashes made with older parameters, and a successful sign-in upgrades them.
 */
const LOG2_N = 15; // N = 32768: ~32 MB and roughly 50-100 ms per hash on a server core.
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

/** Bounds for parameters read back from the database, so a corrupted row cannot make one sign-in eat the server. */
const MAX_LOG2_N = 17;

const derive = (password: string, salt: Buffer, log2n: number, r: number, p: number) =>
  new Promise<Buffer>((resolve, reject) => {
    const N = 2 ** log2n;
    const options: ScryptOptions = { N, r, p, maxmem: 256 * N * r };
    scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, options, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, LOG2_N, R, P);
  return ["scrypt", LOG2_N, R, P, salt.toString("base64"), key.toString("base64")].join("$");
}

function parse(stored: string) {
  const [scheme, log2n, r, p, salt, hash] = stored.split("$");
  const numbers = [Number(log2n), Number(r), Number(p)] as const;
  if (scheme !== "scrypt" || !salt || !hash || !numbers.every(Number.isInteger)) return null;
  const [n, rr, pp] = numbers;
  if (n < 10 || n > MAX_LOG2_N || rr < 1 || rr > 16 || pp < 1 || pp > 16) return null;
  return { log2n: n, r: rr, p: pp, salt: Buffer.from(salt, "base64"), hash: Buffer.from(hash, "base64") };
}

/** Constant-time comparison. An unreadable stored hash never matches. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = parse(stored);
  if (!parts || parts.hash.length !== KEY_LENGTH) return false;
  const key = await derive(password, parts.salt, parts.log2n, parts.r, parts.p);
  return timingSafeEqual(key, parts.hash);
}

/** True when the hash was made with other parameters than the current ones. */
export function needsRehash(stored: string): boolean {
  const parts = parse(stored);
  return !parts || parts.log2n !== LOG2_N || parts.r !== R || parts.p !== P;
}

let dummy: Promise<string> | undefined;
/**
 * Spends the same time as a real check when there is no account to check against, so response time does not tell an
 * attacker which emails are registered.
 */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummy ??= hashPassword(randomBytes(16).toString("hex"));
  await verifyPassword(password, await dummy);
}
