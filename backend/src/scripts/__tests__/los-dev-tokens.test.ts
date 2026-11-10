import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { losVerifierFrom } from "@modules/auth/auth.los.js";
import {
  DEV_LOS_ISSUER,
  devCustomerToken,
  devEnvLines,
  devHandoffToken,
  loadOrCreateDevKeys,
} from "../los-dev-tokens.js";

const dir = mkdtempSync(join(tmpdir(), "los-dev-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** The server as `.env` would configure it after `pnpm los:token setup` (the PEM read back from its env line). */
async function serverWith(publicPem: string) {
  const line = devEnvLines(DEV_LOS_ISSUER, publicPem)[1] as string;
  const LOS_PUBLIC_KEY = line.slice('LOS_PUBLIC_KEY="'.length, -1);
  return losVerifierFrom({
    LOS_ISSUER: DEV_LOS_ISSUER,
    LOS_PUBLIC_KEY,
    LOS_CUSTOMER_AUDIENCE: "luyleun",
    LOS_HANDOFF_AUDIENCE: "chat",
    LOS_HANDOFF_TOKEN_TYPE: "chat-handoff",
  });
}

describe("dev LOS tokens (pnpm los:token)", () => {
  it("creates the key pair once and reuses it", async () => {
    const first = await loadOrCreateDevKeys(dir);
    const again = await loadOrCreateDevKeys(dir);
    expect(again.publicPem).toBe(first.publicPem);
    expect(statSync(join(dir, "private.pem")).mode & 0o077).toBe(0);
  });

  it("makes tokens the server accepts with the printed .env lines", async () => {
    const keys = await loadOrCreateDevKeys(dir);
    const server = await serverWith(keys.publicPem);
    const settings = { issuer: DEV_LOS_ISSUER, userId: 5, username: "Dara", expiresIn: "1h" };

    const customer = await devCustomerToken(keys.privateKey, { ...settings, audience: "luyleun" });
    await expect(server?.verifyCustomer(customer)).resolves.toMatchObject({ losUserId: 5, role: "CUSTOMER" });

    const handoff = await devHandoffToken(keys.privateKey, {
      ...settings,
      audience: "chat",
      tokenType: "chat-handoff",
      role: "supervisor",
    });
    await expect(server?.verifyStaffHandoff(handoff)).resolves.toMatchObject({ losUserId: 5, role: "SUPERVISOR" });
    // Single use, like a real hand-off token.
    await expect(server?.verifyStaffHandoff(handoff)).rejects.toThrow("Invalid LOS token");
  });
});
