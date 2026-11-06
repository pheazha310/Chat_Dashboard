import type { Redis } from "ioredis";
import type { EventBus } from "@shared/events/event-bus.js";
import type { Directory } from "@shared/ports/directory.js";
import type { Storage } from "@shared/storage/storage.js";
import { AssignmentRepository } from "@modules/assignments/assignment.repository.js";
import { AssignmentService } from "@modules/assignments/assignment.service.js";
import { AttachmentRepository } from "@modules/attachments/attachment.repository.js";
import { AttachmentService } from "@modules/attachments/attachment.service.js";
import { ConversationRepository } from "@modules/conversations/conversation.repository.js";
import { ConversationService } from "@modules/conversations/conversation.service.js";
import { MessageRepository } from "@modules/messages/message.repository.js";
import { MessageActionService } from "@modules/messages/message-action.service.js";
import { MessageService } from "@modules/messages/message.service.js";
import { CustomerRepository } from "@modules/customers/customer.repository.js";
import { CustomerService } from "@modules/customers/customer.service.js";
import { NotificationRepository } from "@modules/notifications/notification.repository.js";
import { NotificationService } from "@modules/notifications/notification.service.js";
import { EscalationRepository } from "@modules/escalations/escalation.repository.js";
import { EscalationService } from "@modules/escalations/escalation.service.js";
import { NoteRepository } from "@modules/notes/note.repository.js";
import { NoteService } from "@modules/notes/note.service.js";
import { TagRepository } from "@modules/tags/tag.repository.js";
import { TagService } from "@modules/tags/tag.service.js";
import { CannedResponseRepository } from "@modules/canned-responses/canned-response.repository.js";
import { CannedResponseService } from "@modules/canned-responses/canned-response.service.js";
import { PresenceRepository } from "@modules/presence/presence.repository.js";
import { PresenceService } from "@modules/presence/presence.service.js";
import { WorkspaceRepository } from "@modules/workspace/workspace.repository.js";
import { WorkspaceService } from "@modules/workspace/workspace.service.js";
import { RealtimeService } from "@modules/realtime/index.js";

/**
 * Composition root: builds each service once so the REST routes and the WebSocket gateway share the same instances
 * (and therefore the same business rules). Modules never import this; only routes and the gateway do.
 */
export function createContainer(bus: EventBus, redisClient: Redis, directory: Directory, storage: Storage) {
  // The conversation service reports changes through the realtime service, which reads conversation state back from
  // the conversation service: the function breaks that cycle.
  let conversations!: ConversationService;
  const realtime = new RealtimeService(bus, () => conversations);

  const presence = new PresenceService(new PresenceRepository(redisClient), realtime);
  const notifications = new NotificationService(new NotificationRepository(), realtime, () => conversations);
  const messageRepository = new MessageRepository();
  const messages = new MessageService(messageRepository, notifications, realtime);
  const messageActions = new MessageActionService(messageRepository, messages, realtime);
  conversations = new ConversationService(
    new ConversationRepository(),
    messages,
    realtime,
    directory,
    notifications,
    presence,
  );
  const assignments = new AssignmentService(new AssignmentRepository(), notifications, messages, realtime);
  const attachments = new AttachmentService(
    new AttachmentRepository(),
    storage,
    messages,
    () => conversations,
    realtime,
  );
  const notes = new NoteService(new NoteRepository(), () => conversations, directory, notifications, realtime);
  const escalations = new EscalationService(new EscalationRepository(), () => conversations, realtime);
  const tags = new TagService(new TagRepository(), () => conversations, realtime);
  const cannedResponses = new CannedResponseService(new CannedResponseRepository());
  const workspace = new WorkspaceService(new WorkspaceRepository(), realtime, () => conversations);
  const customers = new CustomerService(new CustomerRepository(), directory, conversations, conversations);

  return {
    bus,
    realtime,
    notifications,
    messages,
    messageActions,
    attachments,
    notes,
    tags,
    cannedResponses,
    escalations,
    conversations,
    assignments,
    presence,
    customers,
    workspace,
  };
}

export type Container = ReturnType<typeof createContainer>;
