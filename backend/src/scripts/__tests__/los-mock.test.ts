import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRemoteJWKSet } from "jose";
import { LosTokenVerifier, parseStaffRoleMap } from "@modules/auth/auth.los.js";
import { loadOrCreateDevKeys } from "../los-dev-tokens.js";
import { createLosMock, MOCK_PASSWORD, MOCK_STAFF_ROLE_MAP } from "../los-mock-app.js";

const dir = mkdtempSync(join(tmpdir(), "los-mock-"));
let server: Server;
let origin: string;
let chat: LosTokenVerifier;

beforeAll(async () => {
  const issuer = "http://localhost/los-mock-test";
  const app = await createLosMock({
    keys: await loadOrCreateDevKeys(dir),
    issuer,
    customerAudience: "luyleun",
    handoffAudience: "chat",
    handoffTokenType: "chat-handoff",
  });
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // The chat backend as `.env` would configure it: the mock's issuer, its JWKS URL and its role map.
  chat = new LosTokenVerifier(
    {
      issuer,
      customerAudience: "luyleun",
      handoffAudience: "chat",
      handoffTokenType: "chat-handoff",
      staffRoleMap: parseStaffRoleMap(MOCK_STAFF_ROLE_MAP),
    },
    createRemoteJWKSet(new URL(`${origin}/.well-known/jwks.json`)),
  );
});

afterAll(async () => {
  await new Promise((resolve) => server?.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

const post = async (path: string, body: unknown) => {
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

describe("mock LOS (pnpm los:mock)", () => {
  it("signs a customer in, and the chat backend accepts the token through the JWKS", async () => {
    const login = await post("/customer/login", { username: "dara", password: MOCK_PASSWORD });
    expect(login.status).toBe(200);
    await expect(chat.verifyCustomer(login.body.losToken as string)).resolves.toEqual({
      losUserType: "CUSTOMER",
      losUserId: 101,
      username: "Dara",
      role: "CUSTOMER",
    });
  });

  it("gives staff a single-use hand-off token whose LOS role maps to the chat role", async () => {
    const agent = await post("/staff/login", { username: "Agent4", password: MOCK_PASSWORD });
    const handoff = agent.body.handoffToken as string;
    await expect(chat.verifyStaffHandoff(handoff)).resolves.toMatchObject({ losUserId: 4, role: "AGENT" });
    await expect(chat.verifyStaffHandoff(handoff)).rejects.toThrow("Invalid LOS token");

    const supervisor = await post("/staff/login", { username: "supervisor9", password: MOCK_PASSWORD });
    await expect(chat.verifyStaffHandoff(supervisor.body.handoffToken as string)).resolves.toMatchObject({
      role: "SUPERVISOR",
    });
    const admin = await post("/staff/login", { username: "admin", password: MOCK_PASSWORD });
    await expect(chat.verifyStaffHandoff(admin.body.handoffToken as string)).resolves.toMatchObject({ role: "ADMIN" });
  });

  it("refuses a wrong password, the other kind of user, and an empty body", async () => {
    expect((await post("/staff/login", { username: "agent4", password: "wrong" })).status).toBe(401);
    expect((await post("/staff/login", { username: "dara", password: MOCK_PASSWORD })).status).toBe(401);
    expect((await post("/customer/login", { username: "agent4", password: MOCK_PASSWORD })).status).toBe(401);
    expect((await post("/customer/login", {})).status).toBe(400);
  });

  it("lists its users without passwords", async () => {
    const users = (await (await fetch(`${origin}/users`)).json()) as Record<string, unknown>[];
    expect(users.length).toBeGreaterThan(0);
    expect(users.every((user) => !("password" in user))).toBe(true);
  });
});
