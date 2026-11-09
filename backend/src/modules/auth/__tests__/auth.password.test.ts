import { describe, expect, it } from "vitest";
import { burnPasswordCheck, hashPassword, needsRehash, verifyPassword } from "../auth.password.js";

describe("password hashing", () => {
  it("verifies the right password and refuses a wrong one", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash).toMatch(/^scrypt\$15\$8\$1\$[^$]+\$[^$]+$/);
    expect(hash).not.toContain("correct horse");
    await expect(verifyPassword("correct horse battery", hash)).resolves.toBe(true);
    await expect(verifyPassword("correct horse batterY", hash)).resolves.toBe(false);
  });

  it("salts every hash", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  it("treats Unicode compatibility forms as the same password", async () => {
    const hash = await hashPassword("ｐａｓｓｗｏｒｄ1"); // full-width letters
    await expect(verifyPassword("password1", hash)).resolves.toBe(true);
  });

  it("never matches an unreadable or out-of-bounds stored hash", async () => {
    await expect(verifyPassword("x", "")).resolves.toBe(false);
    await expect(verifyPassword("x", "bcrypt$2b$10$abc")).resolves.toBe(false);
    await expect(verifyPassword("x", "scrypt$30$8$1$c2FsdA==$aGFzaA==")).resolves.toBe(false);
    await expect(verifyPassword("x", "scrypt$15$8$1$c2FsdA==$c2hvcnQ=")).resolves.toBe(false);
  });

  it("reports hashes made with other parameters as needing a rehash", async () => {
    expect(needsRehash(await hashPassword("x"))).toBe(false);
    expect(needsRehash("scrypt$14$8$1$c2FsdA==$aGFzaA==")).toBe(true);
    expect(needsRehash("garbage")).toBe(true);
  });

  it("can spend a check without an account", async () => {
    await expect(burnPasswordCheck("anything")).resolves.toBeUndefined();
  });
});
