import { describe, expect, it } from "vitest";
import {
  createUserBody,
  devLoginBody,
  loginBody,
  registerBody,
  updateUserBody,
  usernameSchema,
} from "../auth.schema.js";

describe("account profile fields", () => {
  it("accepts staff and customer fields, null to clear", () => {
    expect(updateUserBody.safeParse({ staff: { employeeCode: " E-1 ", maxConcurrentChats: null } }).data).toEqual({
      staff: { employeeCode: "E-1", maxConcurrentChats: null },
    });
    const customer = { phone: "+85512345678", customerCode: "C-1", preferredLanguage: "km" };
    expect(updateUserBody.safeParse({ customer }).success).toBe(true);
    expect(updateUserBody.safeParse({ customer: { preferredLanguage: "en-US" } }).success).toBe(true);
  });

  it.each([
    ["a local phone number", { customer: { phone: "012345678" } }],
    ["a phone number with spaces", { customer: { phone: "+855 12 345 678" } }],
    ["a made-up language", { customer: { preferredLanguage: "khmer!" } }],
    ["zero chats", { staff: { maxConcurrentChats: 0 } }],
    ["an empty code", { staff: { employeeCode: "  " } }],
    ["an unknown profile field", { staff: { nationalId: "123" } }],
  ])("refuses %s", (_, body) => {
    expect(updateUserBody.safeParse(body).success).toBe(false);
  });

  it("takes staff fields, not customer fields, when an admin creates an account", () => {
    const base = { username: "a.user", displayName: "A", role: "AGENT", password: "x".repeat(8) };
    expect(createUserBody.safeParse({ ...base, staff: { department: "Loans" } }).success).toBe(true);
    expect(createUserBody.safeParse({ ...base, customer: { phone: "+85512345678" } }).success).toBe(false);
  });
});

describe("development sign-in body", () => {
  it("fills LOS-style defaults and reads the staff role in any case", () => {
    expect(devLoginBody.parse({ type: "staff" })).toEqual({
      type: "staff",
      userId: 1,
      username: "Dev Staff",
      role: "AGENT",
    });
    expect(devLoginBody.parse({ type: "staff", userId: 7, role: "supervisor" })).toMatchObject({ role: "SUPERVISOR" });
    expect(devLoginBody.parse({ type: "customer" })).toEqual({ type: "customer", userId: 1, username: "Dev Customer" });
  });

  it.each([
    ["no type", {}],
    ["a customer with a role", { type: "customer", role: "agent" }],
    ["an unknown staff role", { type: "staff", role: "teller" }],
    ["a CUSTOMER staff role", { type: "staff", role: "customer" }],
    ["a userId out of LOS range", { type: "staff", userId: 2 ** 31 }],
  ])("refuses %s", (_, body) => {
    expect(devLoginBody.safeParse(body).success).toBe(false);
  });
});

describe("username", () => {
  it("is trimmed and lower-cased", () => {
    expect(usernameSchema.parse("  Sophea.Agent ")).toBe("sophea.agent");
  });

  it.each(["ab", "a".repeat(33), "has space", "-leading", ".dot", "emoji😀", "a@b.com", ""])("refuses %j", (value) => {
    expect(usernameSchema.safeParse(value).success).toBe(false);
  });

  it.each(["abc", "agent_1", "a-b.c", "9lives", "a".repeat(32)])("accepts %j", (value) => {
    expect(usernameSchema.safeParse(value).success).toBe(true);
  });

  it("signs in and registers with a username, not an email", () => {
    expect(loginBody.parse({ username: "Ann", password: "x" })).toEqual({ username: "ann", password: "x" });
    expect(loginBody.safeParse({ email: "ann@example.com", password: "x" }).success).toBe(false);
    expect(registerBody.safeParse({ username: "ann", password: "long-enough", displayName: "Ann" }).success).toBe(true);
  });

  it("lets an admin set an optional contact email when creating an account", () => {
    const base = { username: "ann", displayName: "Ann", role: "AGENT", password: "x".repeat(8) };
    expect(createUserBody.safeParse(base).success).toBe(true);
    expect(createUserBody.parse({ ...base, email: "Ann@Example.com" }).email).toBe("ann@example.com");
    expect(createUserBody.safeParse({ ...base, email: "nope" }).success).toBe(false);
  });
});
