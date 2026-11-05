import { registerAssignmentOpenApi } from "@modules/assignments/assignment.openapi.js";
import { registerConversationOpenApi } from "@modules/conversations/conversation.openapi.js";
import { registerHealthOpenApi } from "@modules/health/health.openapi.js";
import { registerPresenceOpenApi } from "@modules/presence/presence.openapi.js";
import { registerCustomerOpenApi } from "@modules/customers/customer.openapi.js";
import { registerNotificationOpenApi } from "@modules/notifications/notification.openapi.js";
import { registerMessageOpenApi } from "@modules/messages/message.openapi.js";
import { createRegistry, generateDocument } from "@shared/openapi/registry.js";

/** Builds the OpenAPI document from every module's registrations. Served at GET /api/v1/admin/openapi.json. */
export function buildOpenApiDocument() {
  const registry = createRegistry();
  registerHealthOpenApi(registry);
  registerConversationOpenApi(registry);
  registerAssignmentOpenApi(registry);
  registerMessageOpenApi(registry);
  registerPresenceOpenApi(registry);
  registerNotificationOpenApi(registry);
  registerCustomerOpenApi(registry);
  return generateDocument(registry);
}
