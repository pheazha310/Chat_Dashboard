import { registerAttachmentOpenApi } from "@modules/attachments/attachment.openapi.js";
import { registerAssignmentOpenApi } from "@modules/assignments/assignment.openapi.js";
import { registerConversationOpenApi } from "@modules/conversations/conversation.openapi.js";
import { registerHealthOpenApi } from "@modules/health/health.openapi.js";
import { registerEscalationOpenApi } from "@modules/escalations/escalation.openapi.js";
import { registerNoteOpenApi } from "@modules/notes/note.openapi.js";
import { registerTagOpenApi } from "@modules/tags/tag.openapi.js";
import { registerCannedResponseOpenApi } from "@modules/canned-responses/canned-response.openapi.js";
import { registerPresenceOpenApi } from "@modules/presence/presence.openapi.js";
import { registerCustomerOpenApi } from "@modules/customers/customer.openapi.js";
import { registerNotificationOpenApi } from "@modules/notifications/notification.openapi.js";
import { registerMessageActionOpenApi } from "@modules/messages/message-action.openapi.js";
import { registerMessageOpenApi } from "@modules/messages/message.openapi.js";
import { registerCallbackOpenApi } from "@modules/callbacks/callback.openapi.js";
import { registerChatSettingsOpenApi } from "@modules/chat-settings/chat-settings.openapi.js";
import { registerWorkspaceOpenApi } from "@modules/workspace/workspace.openapi.js";
import { createRegistry, generateDocument } from "@shared/openapi/registry.js";

/** Builds the OpenAPI document from every module's registrations. Served at GET /api/v1/admin/openapi.json. */
export function buildOpenApiDocument() {
  const registry = createRegistry();
  registerHealthOpenApi(registry);
  registerConversationOpenApi(registry);
  registerAssignmentOpenApi(registry);
  registerMessageOpenApi(registry);
  registerMessageActionOpenApi(registry);
  registerAttachmentOpenApi(registry);
  registerNoteOpenApi(registry);
  registerTagOpenApi(registry);
  registerCannedResponseOpenApi(registry);
  registerEscalationOpenApi(registry);
  registerPresenceOpenApi(registry);
  registerNotificationOpenApi(registry);
  registerCustomerOpenApi(registry);
  registerWorkspaceOpenApi(registry);
  registerChatSettingsOpenApi(registry);
  registerCallbackOpenApi(registry);
  return generateDocument(registry);
}
