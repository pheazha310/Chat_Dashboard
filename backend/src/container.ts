import type { Redis } from "ioredis";
import type { EventBus } from "@shared/events/event-bus.js";
import type { Directory } from "@shared/ports/directory.js";
import { AssignmentRepository } from "@modules/assignments/assignment.repository.js";
import { AssignmentService } from "@modules/assignments/assignment.service.js";
import { ConversationRepository } from "@modules/conversations/conversation.repository.js";
import { ConversationService } from "@modules/conversations/conversation.service.js";
import { MessageRepository } from "@modules/messages/message.repository.js";
import { MessageService } from "@modules/messages/message.service.js";
import { CustomerRepository } from "@modules/customers/customer.repository.js";
import { CustomerService } from "@modules/customers/customer.service.js";
import { NotificationRepository } from "@modules/notifications/notification.repository.js";
import { NotificationService } from "@modules/notifications/notification.service.js";
import { PresenceRepository } from "@modules/presence/presence.repository.js";
import { PresenceService } from "@modules/presence/presence.service.js";
import { RealtimeService } from "@modules/realtime/index.js";

/**
 * Composition root: builds each service once so the REST routes and the WebSocket gateway share the same instances
 * (and therefore the same business rules). Modules never import this; only routes and the gateway do.
 */
export function createContainer(bus: EventBus, redisClient: Redis, directory: Directory) {
  // The conversation service reports changes through the realtime service, which reads conversation state back from
  // the conversation service: the function breaks that cycle.
  let conversations!: ConversationService;
  const realtime = new RealtimeService(bus, () => conversations);

  const presence = new PresenceService(new PresenceRepository(redisClient), realtime);
  const notifications = new NotificationService(new NotificationRepository(), realtime, () => conversations);
  const messages = new MessageService(new MessageRepository(), notifications, realtime);
  conversations = new ConversationService(
    new ConversationRepository(),
    messages,
    realtime,
    directory,
    notifications,
    presence,
  );
  const assignments = new AssignmentService(new AssignmentRepository(), notifications, messages, realtime);
  const customers = new CustomerService(new CustomerRepository(), directory, conversations, conversations);

  return { bus, realtime, notifications, messages, conversations, assignments, presence, customers };
}

export type Container = ReturnType<typeof createContainer>;
