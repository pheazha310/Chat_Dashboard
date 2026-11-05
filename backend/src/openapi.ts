import { registerAssignmentOpenApi } from "@modules/assignments/assignment.openapi.js";
import { registerConversationOpenApi } from "@modules/conversations/conversation.openapi.js";
import { registerHealthOpenApi } from "@modules/health/health.openapi.js";
import { registerMessageOpenApi } from "@modules/messages/message.openapi.js";
import { createRegistry, generateDocument } from "@shared/openapi/registry.js";

/** Builds the OpenAPI document from every module's registrations. Served at GET /api/openapi.json. */
export function buildOpenApiDocument() {
  const registry = createRegistry();
  registerHealthOpenApi(registry);
  registerConversationOpenApi(registry);
  registerAssignmentOpenApi(registry);
  registerMessageOpenApi(registry);
  return generateDocument(registry);
}
