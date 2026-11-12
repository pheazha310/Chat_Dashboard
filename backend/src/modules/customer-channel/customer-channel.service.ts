import type { CursorQuery } from "@shared/utils/pagination.js";
import type { AttachmentService, UploadedFile } from "@modules/attachments/attachment.service.js";
import type { VoiceFields } from "@modules/attachments/attachment.schema.js";
import type { CallService } from "@modules/calls/call.service.js";
import type { ConversationService } from "@modules/conversations/conversation.service.js";
import type { MessageService } from "@modules/messages/message.service.js";
import type { ChatSendInput, JoinInput, SendInput, StartCallInput } from "./customer-channel.schema.js";

/**
 * What the customer's mobile app can do: join its conversation, send text, files and voice, read the messages, and
 * call staff or answer their calls.
 * Every method takes the `customerId` of the verified token and only ever touches that customer's conversations
 * (a conversation of anybody else is reported as not found). The rules themselves live in the conversation, message
 * and attachment services, shared with the dashboard; this class only gives the mobile app its entry points.
 */
export class CustomerChannelService {
  constructor(
    private readonly conversations: ConversationService,
    private readonly messages: MessageService,
    private readonly attachments: AttachmentService,
    private readonly calls: CallService,
  ) {}

  /** Join room: finds the customer's conversation (for the application) or creates it, then returns it. */
  join(customerId: string, input: JoinInput) {
    return this.conversations.joinForCustomer(customerId, input);
  }

  /** The customer's one conversation (`/conversation`), created on first use like join room. */
  async mine(customerId: string) {
    return (await this.join(customerId, {})).conversation;
  }

  async historyOfMine(customerId: string, query: CursorQuery) {
    const { id } = await this.mine(customerId);
    return this.history(customerId, id, query);
  }

  async sendToMine(customerId: string, input: ChatSendInput) {
    const { id } = await this.mine(customerId);
    if (input.type === "FILE") {
      return this.attachments.sendStagedFromCustomer(customerId, id, {
        clientId: input.clientId,
        attachmentId: input.attachmentId as string,
        text: input.text,
      });
    }
    return this.sendText(customerId, id, { clientId: input.clientId, text: input.text as string });
  }

  async uploadToMine(customerId: string, file: UploadedFile | undefined) {
    const { id } = await this.mine(customerId);
    return this.attachments.stageFromCustomer(customerId, id, file);
  }

  conversation(customerId: string, conversationId: string) {
    return this.conversations.getForCustomer(customerId, conversationId);
  }

  /** Retrieve messages, oldest to newest. Same cursors as the dashboard: none, `before`, or `after` (catch-up). */
  async history(customerId: string, conversationId: string, query: CursorQuery) {
    await this.conversations.requireForCustomer(customerId, conversationId);
    return this.messages.historyForCustomer(conversationId, query);
  }

  sendText(customerId: string, conversationId: string, input: SendInput) {
    return this.messages.receiveFromCustomer({ customerId, conversationId, ...input });
  }

  sendFile(
    customerId: string,
    conversationId: string,
    fields: { clientId: string; text?: string | undefined },
    file: UploadedFile | undefined,
  ) {
    return this.attachments.uploadFromCustomer(customerId, conversationId, fields, file);
  }

  sendVoice(customerId: string, conversationId: string, fields: VoiceFields, file: UploadedFile | undefined) {
    return this.attachments.uploadVoiceFromCustomer(customerId, conversationId, fields, file);
  }

  download(customerId: string, attachmentId: string, options: { range?: string | undefined; inline: boolean }) {
    return this.attachments.downloadForCustomer(customerId, attachmentId, options);
  }

  audio(customerId: string, messageId: string, options: { range?: string | undefined }) {
    return this.attachments.messageAudioForCustomer(customerId, messageId, options);
  }

  // ─── calls (docs/api-calls.md): the customer's half, the rules live in CallService ─────

  /** The customer calls; every agent who may see the conversation is alerted. */
  startCall(customerId: string, conversationId: string, input: StartCallInput) {
    return this.calls.initiateFromCustomer({ customerId, conversationId, callType: input.callType });
  }

  /** Answers a ringing call an agent started. */
  acceptCall(customerId: string, callId: string) {
    return this.calls.acceptByCustomer(customerId, callId);
  }

  declineCall(customerId: string, callId: string) {
    return this.calls.declineByCustomer(customerId, callId);
  }

  /** Stops a ringing call the customer started. */
  cancelCall(customerId: string, callId: string) {
    return this.calls.cancelByCustomer(customerId, callId);
  }

  /** Hangs up an answered call. */
  endCall(customerId: string, callId: string) {
    return this.calls.endByCustomer(customerId, callId);
  }
}
