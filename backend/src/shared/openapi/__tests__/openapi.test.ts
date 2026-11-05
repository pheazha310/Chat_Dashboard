import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "../../../openapi.js";

type Operation = {
  security?: unknown[];
  responses: Record<string, unknown>;
  parameters?: { name: string; in: string }[];
  requestBody?: unknown;
};

describe("OpenAPI document", () => {
  const doc = buildOpenApiDocument();
  const operations = Object.entries(doc.paths ?? {}).flatMap(([path, item]) =>
    (["get", "post", "put", "patch", "delete"] as const).flatMap((method) => {
      const operation = (item as Record<string, Operation | undefined>)[method];
      return operation ? [{ key: `${method.toUpperCase()} ${path}`, path, operation }] : [];
    }),
  );
  const keys = operations.map((o) => o.key);

  it("documents every implemented route (add new routes here and in the module's .openapi.ts)", () => {
    expect(keys.sort()).toEqual(
      [
        "GET /health",
        "GET /conversations",
        "POST /conversations",
        "GET /conversations/{id}",
        "GET /conversations/{id}/activities",
        "PATCH /conversations/{id}/status",
        "POST /conversations/{id}/archive",
        "POST /conversations/{id}/restore",
        "POST /conversations/{id}/assign",
        "POST /conversations/{id}/transfer",
        "POST /conversations/{id}/unassign",
        "GET /conversations/{id}/assignments",
        "POST /conversations/{id}/messages",
        "GET /conversations/{id}/messages",
        "POST /conversations/{id}/messages/{messageId}/delivered",
        "POST /conversations/{id}/read",
        "POST /conversations/{id}/unread",
        "GET /presence",
        "PUT /presence/me",
        "GET /notifications",
        "GET /notifications/unread-count",
        "PATCH /notifications/{id}/read",
        "POST /notifications/read-all",
        "GET /notifications/preferences",
        "PUT /notifications/preferences",
        "PUT /conversations/{id}/mute",
        "GET /conversations/{id}/customer",
        "GET /conversations/{id}/customer/conversations",
        "GET /conversations/{id}/participants",
      ].sort(),
    );
  });

  it("requires the bearer token everywhere except /health", () => {
    for (const { key, path, operation } of operations) {
      if (path === "/health") expect(operation.security, key).toBeUndefined();
      else expect(operation.security, key).toEqual([{ bearerAuth: [] }]);
    }
    expect(doc.components?.securitySchemes?.bearerAuth).toMatchObject({ type: "http", scheme: "bearer" });
  });

  it("documents the error responses of authenticated routes", () => {
    for (const { key, path, operation } of operations.filter((o) => o.path !== "/health")) {
      expect(Object.keys(operation.responses), key).toEqual(expect.arrayContaining(["401"]));
      if (path.includes("{id}")) expect(Object.keys(operation.responses), key).toContain("404");
    }
  });

  it("describes ids as strings with a pattern, not as BigInt", () => {
    const detail = operations.find((o) => o.key === "GET /conversations/{id}")?.operation;
    expect(detail?.parameters?.[0]).toMatchObject({ name: "id", in: "path", schema: { type: "string" } });
  });

  it("describes the send body and the cursor query", () => {
    const send = JSON.stringify(
      operations.find((o) => o.key === "POST /conversations/{id}/messages")?.operation.requestBody,
    );
    expect(send).toContain("clientId");
    const history = operations.find((o) => o.key === "GET /conversations/{id}/messages")?.operation;
    expect(history?.parameters?.filter((p) => p.in === "query").map((p) => p.name)).toEqual(
      expect.arrayContaining(["before", "after", "limit"]),
    );
  });

  it("is serializable JSON", () => {
    expect(() => JSON.parse(JSON.stringify(doc))).not.toThrow();
  });
});
