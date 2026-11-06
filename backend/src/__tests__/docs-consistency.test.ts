import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "../openapi.js";
import { clientEvents } from "../websocket/websocket.events.js";

/**
 * The documentation is part of the product here (the project rules say docs and code change together), so this test
 * fails when they drift: a route missing from the Postman collection, an event nobody documented, an environment
 * variable missing from `.env.example`. It reads files only; no database is needed.
 */
const root = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(root, path), "utf8");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory())
      return entry.name === "__tests__" || entry.name === "node_modules" ? [] : sourceFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

const normalize = (path: string) => path.replace(/\{\{?\w+\}?\}/g, "{}");

describe("documentation matches the code", () => {
  it("lists every REST route in the Postman collection", () => {
    const collection = JSON.parse(read("docs/postman/chat-dashboard.postman_collection.json")) as {
      item: unknown[];
    };
    const requests = new Set<string>();
    const walk = (items: unknown[]) => {
      for (const item of items as { item?: unknown[]; request?: { method: string; url: { raw: string } } }[]) {
        if (item.item) walk(item.item);
        else if (item.request) {
          const path = item.request.url.raw.replace("{{baseUrl}}", "").replace("/api/v1/admin", "").split("?")[0] ?? "";
          requests.add(`${item.request.method} ${normalize(path)}`);
        }
      }
    };
    walk(collection.item);

    const spec = buildOpenApiDocument() as unknown as { paths: Record<string, Record<string, unknown>> };
    const missing: string[] = [];
    for (const [path, methods] of Object.entries(spec.paths)) {
      if (path === "/health") continue; // served at /api/health, listed separately
      for (const method of Object.keys(methods)) {
        const key = `${method.toUpperCase()} ${normalize(path)}`;
        if (!requests.has(key)) missing.push(key);
      }
    }
    expect(missing, "routes missing from docs/postman/chat-dashboard.postman_collection.json").toEqual([]);
  });

  it("documents every event the server sends or accepts in websocket-events.md", () => {
    const docs = read("docs/websocket-events.md");
    const literal =
      /"((?:message|conversation|note|callback|call|attachment|workspace|chat_settings|spam|customer|notification|presence|typing|sync|connection)\.[a-z_]+)"/g;
    const names = new Set<string>(Object.keys(clientEvents));
    for (const file of sourceFiles(join(root, "backend/src"))) {
      for (const match of readFileSync(file, "utf8").matchAll(literal)) names.add(match[1] as string);
    }
    const undocumented = [...names].filter((name) => !docs.includes(name)).sort();
    expect(undocumented, "events missing from docs/websocket-events.md").toEqual([]);
  });

  it("has every environment variable in .env.example and in the docs", () => {
    const keys = [...read("backend/src/config/env.ts").matchAll(/^ {2}([A-Z][A-Z0-9_]+):/gm)].map(
      (m) => m[1] as string,
    );
    expect(keys.length).toBeGreaterThan(10);
    const example = read("backend/.env.example");
    const docs = [
      "AGENTS.md",
      ...readdirSync(join(root, "docs"))
        .filter((f) => f.endsWith(".md"))
        .map((f) => `docs/${f}`),
    ]
      .map(read)
      .join("\n");
    const quiet = new Set(["NODE_ENV", "LOG_LEVEL"]); // self-explanatory; not worth a docs mention
    expect(
      keys.filter((key) => !new RegExp(`^#? ?${key}=`, "m").test(example)),
      "missing from backend/.env.example",
    ).toEqual([]);
    expect(
      keys.filter((key) => !quiet.has(key) && !docs.includes(key)),
      "never mentioned in the docs",
    ).toEqual([]);
  });

  it("links every API guide from AGENTS.md so agents find it", () => {
    const agents = read("AGENTS.md");
    const guides = readdirSync(join(root, "docs")).filter(
      (f) => /^api-.*\.md$/.test(f) && f !== "api-response-contracts.md",
    );
    expect(
      guides.filter((guide) => !agents.includes(`docs/${guide}`)),
      "api guides AGENTS.md does not mention",
    ).toEqual([]);
  });
});
