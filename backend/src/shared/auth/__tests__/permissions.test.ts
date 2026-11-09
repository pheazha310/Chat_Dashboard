import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { uid } from "../../../__tests__/support/ids.js";
import { DEFAULT_ROLE_PERMISSIONS, PERMISSION_NAMES, can } from "../permissions.js";

const migrations = path.resolve(import.meta.dirname, "../../../../prisma/migrations");
const allSql = readdirSync(migrations)
  .filter((dir) => !dir.endsWith(".toml"))
  .sort()
  .map((dir) => readFileSync(path.join(migrations, dir, "migration.sql"), "utf8"))
  .join("\n");

describe("permission catalogue", () => {
  it("is seeded by the migrations exactly as the code defines it", () => {
    const seeded = [...allSql.matchAll(/^\s*\('([a-z_]+)', '([a-z_]+)', '/gm)].map(([, m, a]) => `${m}.${a}`);
    expect(seeded.sort()).toEqual([...PERMISSION_NAMES].sort());
  });

  it("seeds exactly the default grants", () => {
    const grants = [...allSql.matchAll(/^\s*\('(CUSTOMER|AGENT|SUPERVISOR|ADMIN)', '([a-z_]+)', '([a-z_]+)'\)/gm)].map(
      ([, role, m, a]) => `${role}:${m}.${a}`,
    );
    const expected = Object.entries(DEFAULT_ROLE_PERMISSIONS).flatMap(([role, list]) =>
      list.map((p) => `${role}:${p}`),
    );
    expect(grants.sort()).toEqual(expected.sort());
  });

  it("names every permission module.action in lower case", () => {
    for (const name of PERMISSION_NAMES) expect(name).toMatch(/^[a-z_]+\.[a-z_]+$/);
  });
});

describe("can", () => {
  it("uses the permissions loaded with the identity when present", () => {
    const agent = { userId: uid(1), role: "AGENT" as const, permissions: new Set(["tags.delete"]) };
    expect(can(agent, "tags.delete")).toBe(true);
    expect(can(agent, "conversations.view_all")).toBe(false);
    // Loaded permissions win over the defaults, also when they take something away.
    expect(can({ userId: uid(2), role: "ADMIN", permissions: new Set() }, "users.manage")).toBe(false);
  });

  it("falls back to the default grants: supervisors everything but accounts and roles, admins everything", () => {
    expect(can({ userId: uid(1), role: "AGENT" }, "conversations.view_all")).toBe(false);
    expect(can({ userId: uid(1), role: "SUPERVISOR" }, "conversations.view_all")).toBe(true);
    expect(can({ userId: uid(1), role: "SUPERVISOR" }, "users.manage")).toBe(false);
    expect(can({ userId: uid(1), role: "ADMIN" }, "roles.manage")).toBe(true);
    expect(can({ userId: uid(1), role: "CUSTOMER" }, "tags.delete")).toBe(false);
  });
});
