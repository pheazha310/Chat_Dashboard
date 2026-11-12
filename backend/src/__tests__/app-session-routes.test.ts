import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../app.js";

/** The sign-in URLs of the Postman "Chat Backend" collection. No database: a bad body is refused before any lookup. */
let server: Server;
let base: string;

beforeAll(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

const post = (path: string, body: unknown) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("session endpoints", () => {
  it("customer session validates { losToken }", async () => {
    expect((await post("/customer/api/v1/auth/session", {})).status).toBe(400);
  });

  it("agent session validates { handoffToken }", async () => {
    expect((await post("/agent/api/v1/auth/session", { losToken: "x".repeat(30) })).status).toBe(400);
  });

  it("customer /auth/me and chat routes need a token", async () => {
    expect((await fetch(`${base}/customer/api/v1/auth/me`)).status).toBe(401);
    expect((await fetch(`${base}/customer/api/v1/chat/conversations/x`)).status).toBe(401);
  });

  it("the customer's id-less chat routes need a token", async () => {
    for (const path of ["conversation", "conversation/messages"]) {
      expect((await fetch(`${base}/customer/api/v1/chat/${path}`)).status).toBe(401);
    }
    expect((await post("/customer/api/v1/chat/conversation/messages", {})).status).toBe(401);
    expect((await post("/customer/api/v1/chat/attachments", {})).status).toBe(401);
  });

  it("serves {{baseUrl}}/api/v1/customer and {{baseUrl}}/api/v1/agents", async () => {
    expect((await post("/api/v1/customer/auth/session", {})).status).toBe(400);
    expect((await post("/api/v1/agents/auth/session", { losToken: "x".repeat(30) })).status).toBe(400);
    expect((await fetch(`${base}/api/v1/customer/conversation`)).status).toBe(401);
    expect((await fetch(`${base}/api/v1/agents/conversations`)).status).toBe(401);
  });

  it("agent chat routes need a token", async () => {
    expect((await fetch(`${base}/agent/api/v1/chat/conversations`)).status).toBe(401);
  });
});
