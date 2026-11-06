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
        "PATCH /conversations/{id}/priority",
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
        "POST /messages/{messageId}/replies",
        "PATCH /messages/{messageId}",
        "DELETE /messages/{messageId}",
        "GET /messages/{messageId}/history",
        "PUT /messages/{messageId}/reactions",
        "DELETE /messages/{messageId}/reactions/{reactionId}",
        "POST /messages/{messageId}/forwards",
        "POST /attachments/upload",
        "POST /conversations/{conversationId}/voice-messages",
        "GET /conversations/{conversationId}/attachments",
        "GET /attachments/{attachmentId}",
        "GET /attachments/{attachmentId}/download",
        "GET /messages/{messageId}/audio",
        "DELETE /attachments/{attachmentId}",
        "GET /conversations/{id}/notes",
        "POST /conversations/{id}/notes",
        "PATCH /notes/{noteId}",
        "DELETE /notes/{noteId}",
        "GET /conversations/{id}/escalations",
        "POST /conversations/{id}/escalations",
        "PATCH /escalations/{escalationId}",
        "GET /tags",
        "POST /tags",
        "PATCH /tags/{tagId}",
        "DELETE /tags/{tagId}",
        "PUT /conversations/{id}/tags",
        "GET /canned-responses",
        "POST /canned-responses",
        "GET /canned-responses/{templateId}",
        "PATCH /canned-responses/{templateId}",
        "DELETE /canned-responses/{templateId}",
        "GET /callbacks",
        "GET /callbacks/{callbackId}",
        "PATCH /callbacks/{callbackId}",
        "POST /callbacks/{callbackId}/complete",
        "POST /callbacks/{callbackId}/cancel",
        "GET /conversations/{id}/callbacks",
        "POST /conversations/{id}/callbacks",
        "GET /agents/me/chat-settings",
        "PATCH /agents/me/chat-settings",
        "GET /workspace",
        "PATCH /workspace/preferences",
        "PUT /workspace/tabs/{conversationId}",
        "DELETE /workspace/tabs/{conversationId}",
        "PUT /workspace/drafts/{conversationId}",
        "DELETE /workspace/drafts/{conversationId}",
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
