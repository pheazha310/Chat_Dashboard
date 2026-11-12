import { createHash, randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { logger } from "@config/logger.js";
import { AppError, BadRequestError, ForbiddenError, NotFoundError } from "@shared/errors/AppError.js";
import type { AuthContext } from "@shared/auth/auth.types.js";
import { can } from "@shared/auth/permissions.js";
import { permissionsFor } from "@shared/policy/conversation-access.js";
import type { ConversationAccess, CustomerConversationAccess } from "@shared/ports/conversation-access.js";
import type { RealtimeNotifier } from "@shared/ports/realtime.js";
import type { Storage } from "@shared/storage/storage.js";
import { bestEffort } from "@shared/utils/best-effort.js";
import { idToString } from "@shared/utils/ids.js";
import { pageMeta } from "@shared/utils/pagination.js";
import type { MessageService } from "@modules/messages/message.service.js";
import { toAttachment } from "@modules/messages/message.mapper.js";
import type { AttachmentDto } from "@modules/messages/message.types.js";
import { parseRange, type ByteRange } from "./attachment.range.js";
import type { AttachmentRepository } from "./attachment.repository.js";
import type { ListQuery, UploadFields, VoiceFields } from "./attachment.schema.js";
import { INLINE_SAFE, kindOf, messageTypeFor, validateFile, type AttachmentKind } from "./attachment.validation.js";

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** What a download needs to answer: headers and the bytes (the whole file, or one range of it). */
export interface FileResponse {
  status: 200 | 206;
  mimeType: string;
  fileName: string;
  kind: AttachmentKind;
  size: number;
  range: { start: number; end: number } | null;
  inline: boolean;
  stream: Readable;
}

/** Who is sending: a dashboard agent, or a customer on the mobile channel. */
type Sender = { kind: "agent"; auth: AuthContext } | { kind: "customer"; customerId: string };

const LABEL: Record<string, string> = { IMAGE: "Photo", DOCUMENT: "File", AUDIO: "Audio", VIDEO: "Video" };

/**
 * Files and voice messages in conversations. The bytes live in `Storage`, the metadata in PostgreSQL. Every read
 * and write first resolves the conversation and applies the same visibility rule as the rest of the API, so a file
 * of a conversation the caller cannot open is reported as not found.
 */
export class AttachmentService {
  constructor(
    private readonly repository: AttachmentRepository,
    private readonly storage: Storage,
    private readonly messages: MessageService,
    private readonly conversations: () => ConversationAccess & CustomerConversationAccess,
    private readonly realtime: RealtimeNotifier,
  ) {}

  /** Sends a message that carries one file (and an optional caption). */
  upload(auth: AuthContext, fields: UploadFields, file: UploadedFile | undefined) {
    return this.store(
      { kind: "agent", auth },
      fields.conversationId,
      { clientId: fields.clientId, text: fields.text },
      file,
      false,
    );
  }

  /** Sends a recorded voice message. */
  uploadVoice(auth: AuthContext, conversationId: string, fields: VoiceFields, file: UploadedFile | undefined) {
    return this.store({ kind: "agent", auth }, conversationId, { clientId: fields.clientId }, file, true, fields);
  }

  /** A customer sends a file (and an optional caption) in their own conversation. */
  uploadFromCustomer(
    customerId: string,
    conversationId: string,
    fields: { clientId: string; text?: string | undefined },
    file: UploadedFile | undefined,
  ) {
    return this.store({ kind: "customer", customerId }, conversationId, fields, file, false);
  }

  /** A customer uploads a file now and sends it later as a message (`sendStagedFromCustomer`). */
  async stageFromCustomer(customerId: string, conversationId: string, file: UploadedFile | undefined) {
    if (!file) throw new BadRequestError('Send the file in a multipart field named "file"');
    await this.conversations().requireForCustomer(customerId, conversationId);
    const checked = validateFile(file, { voice: false });
    const storageKey = `conversations/${conversationId}/${randomUUID()}.${checked.extension}`;
    await this.storage.put(storageKey, file.buffer);
    try {
      const row = await this.repository.stage({
        conversationId,
        uploadedById: customerId,
        storageKey,
        fileName: checked.fileName,
        mimeType: checked.mimeType,
        fileSize: file.size,
        checksumSha256: createHash("sha256").update(file.buffer).digest("hex"),
      });
      return toAttachment(row);
    } catch (error) {
      await this.discard(storageKey);
      throw error;
    }
  }

  /** A customer sends a file they uploaded earlier as a message, with an optional caption. */
  async sendStagedFromCustomer(
    customerId: string,
    conversationId: string,
    fields: { clientId: string; attachmentId: string; text?: string | undefined },
  ) {
    await this.conversations().requireForCustomer(customerId, conversationId);
    const staged = await this.repository.findStaged(fields.attachmentId, conversationId, customerId);
    if (!staged) throw new NotFoundError("Attachment not found");
    const kind = kindOf(staged.mimeType);
    const result = await this.messages.receiveFileFromCustomer({
      customerId,
      conversationId,
      clientId: fields.clientId,
      text: fields.text,
      messageType: messageTypeFor(kind, false),
      preview: `${LABEL[kind]}: ${staged.fileName}`,
      attachment: { stagedId: staged.id },
    });
    const attachment = result.message.attachments[0];
    if (result.created && attachment) {
      await bestEffort("realtime attachment.uploaded", () =>
        this.realtime.messageEvent(conversationId, "attachment.uploaded", { attachment }),
      );
    }
    return result;
  }

  /** A customer sends a recorded voice message in their own conversation. */
  uploadVoiceFromCustomer(
    customerId: string,
    conversationId: string,
    fields: VoiceFields,
    file: UploadedFile | undefined,
  ) {
    return this.store(
      { kind: "customer", customerId },
      conversationId,
      { clientId: fields.clientId },
      file,
      true,
      fields,
    );
  }

  /** The bytes of a file in one of the customer's own conversations. Honours a single `Range`. */
  async downloadForCustomer(
    customerId: string,
    attachmentId: string,
    options: { range?: string | undefined; inline: boolean },
  ) {
    const row = await this.repository.findLive(attachmentId);
    if (!row) throw new NotFoundError("File not found");
    await this.conversations().requireForCustomer(customerId, row.conversationId);
    return this.open(row, options);
  }

  /** The audio of a voice message in one of the customer's own conversations. */
  async messageAudioForCustomer(customerId: string, messageId: string, options: { range?: string | undefined }) {
    const row = await this.repository.findAudioOfMessage(messageId);
    if (!row) throw new NotFoundError("File not found");
    await this.conversations().requireForCustomer(customerId, row.conversationId);
    return this.open(row, { ...options, inline: true });
  }

  async list(auth: AuthContext, conversationId: string, query: ListQuery) {
    await this.conversations().requireVisible(auth, conversationId);
    const { items, total } = await this.repository.list(conversationId, query);
    return {
      items: items.map((row) => toAttachment(row, row.messageAttachments[0]?.messageId ?? null)),
      meta: pageMeta(total, query),
    };
  }

  async get(auth: AuthContext, attachmentId: string): Promise<AttachmentDto> {
    const row = await this.visible(auth, await this.repository.findLive(attachmentId));
    return toAttachment(row, row.messageAttachments[0]?.messageId ?? null);
  }

  /** The file's bytes, for preview or download. Honours a single `Range` so audio and video can seek. */
  async download(auth: AuthContext, attachmentId: string, options: { range?: string | undefined; inline: boolean }) {
    return this.open(await this.visible(auth, await this.repository.findLive(attachmentId)), options);
  }

  /** The audio of a voice or audio message. */
  async messageAudio(auth: AuthContext, messageId: string, options: { range?: string | undefined }) {
    return this.open(await this.visible(auth, await this.repository.findAudioOfMessage(messageId)), {
      ...options,
      inline: true,
    });
  }

  /** The uploader, or a supervisor/admin. Soft delete only: the record and the stored bytes are kept. */
  async remove(auth: AuthContext, attachmentId: string) {
    const row = await this.visible(auth, await this.repository.findLive(attachmentId));
    const own = row.uploadedByType === "AGENT" && row.uploadedById === auth.userId;
    if (!own && !can(auth, "attachments.delete_any"))
      throw new ForbiddenError("You can only delete files you uploaded");
    if (!(await this.repository.softDelete(row.id))) throw new NotFoundError("File not found");

    const messageId = row.messageAttachments[0]?.messageId ?? null;
    const result = {
      id: idToString(row.id),
      conversationId: idToString(row.conversationId),
      messageId: messageId === null ? null : idToString(messageId),
    };
    await bestEffort("realtime attachment.deleted", () =>
      this.realtime.messageEvent(result.conversationId, "attachment.deleted", result),
    );
    return result;
  }

  // ─── internals ─────────────────────────────────────────────────────────────

  private async store(
    sender: Sender,
    conversationId: string,
    fields: { clientId: string; text?: string | undefined },
    file: UploadedFile | undefined,
    voice: boolean,
    voiceFields?: VoiceFields,
  ) {
    if (!file) throw new BadRequestError('Send the file in a multipart field named "file"');
    if (sender.kind === "agent") {
      const state = await this.conversations().requireVisible(sender.auth, conversationId);
      if (!permissionsFor(sender.auth, state).canSendMessage) {
        throw new ForbiddenError("Only the agent who owns an open conversation can send files");
      }
    } else {
      await this.conversations().requireForCustomer(sender.customerId, conversationId);
    }
    const checked = validateFile(file, { voice });

    // The name is generated here; the client's file name is only a label and never reaches the file system.
    const storageKey = `conversations/${conversationId}/${randomUUID()}.${checked.extension}`;
    await this.storage.put(storageKey, file.buffer);

    let result;
    try {
      const common = {
        clientId: fields.clientId,
        text: fields.text,
        messageType: messageTypeFor(checked.kind, voice),
        preview: voice ? "Voice message" : `${LABEL[checked.kind]}: ${checked.fileName}`,
        attachment: {
          storageKey,
          fileName: checked.fileName,
          mimeType: checked.mimeType,
          fileSize: file.size,
          durationMs: voiceFields?.durationMs,
          waveform: voiceFields?.waveform,
          checksumSha256: createHash("sha256").update(file.buffer).digest("hex"),
        },
      };
      result =
        sender.kind === "agent"
          ? await this.messages.sendWithAttachment(sender.auth, conversationId, common)
          : await this.messages.receiveFileFromCustomer({
              ...common,
              customerId: sender.customerId,
              conversationId,
            });
    } catch (error) {
      await this.discard(storageKey);
      throw error;
    }
    // A retry of a message that already exists: the file just stored is a duplicate.
    if (!result.created) {
      await this.discard(storageKey);
      return result;
    }

    const attachment = result.message.attachments[0];
    if (attachment) {
      await bestEffort("realtime attachment.uploaded", () =>
        this.realtime.messageEvent(conversationId, "attachment.uploaded", { attachment }),
      );
    }
    return result;
  }

  /** Removes a stored file that no message references. A failure leaves an orphan and is only logged. */
  private async discard(storageKey: string) {
    try {
      await this.storage.delete(storageKey);
    } catch (error) {
      logger.warn({ err: error, storageKey }, "could not remove an unreferenced upload");
    }
  }

  private async visible<T extends { conversationId: string }>(auth: AuthContext, row: T | null): Promise<T> {
    if (!row) throw new NotFoundError("File not found");
    await this.conversations().requireVisible(auth, row.conversationId);
    return row;
  }

  private async open(
    row: NonNullable<Awaited<ReturnType<AttachmentRepository["findLive"]>>>,
    options: { range?: string | undefined; inline: boolean },
  ): Promise<FileResponse> {
    const stat = await this.storage.stat(row.storageKey);
    if (!stat) {
      logger.error({ attachmentId: row.id }, "stored file is missing");
      throw new NotFoundError("File not found");
    }
    const requested: ByteRange = parseRange(options.range, stat.size);
    if (requested === "unsatisfiable") {
      throw new RangeNotSatisfiable(stat.size);
    }
    const dto = toAttachment(row);
    return {
      status: requested ? 206 : 200,
      mimeType: row.mimeType,
      fileName: row.fileName,
      kind: dto.kind,
      size: stat.size,
      range: requested,
      // Only types a browser cannot run as a page are ever shown inline.
      inline: options.inline && INLINE_SAFE.has(dto.kind),
      stream: this.storage.open(row.storageKey, requested ?? undefined),
    };
  }
}

/** A `Range` that starts beyond the end of the file (416). */
export class RangeNotSatisfiable extends AppError {
  constructor(readonly size: number) {
    super(416, "RANGE_NOT_SATISFIABLE", "Range not satisfiable");
  }
}
