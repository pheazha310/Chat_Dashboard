import { prisma, type Db } from "@config/database.js";
import type { Prisma } from "../../../prisma/generated/prisma/client.js";
import { pageArgs } from "@shared/utils/pagination.js";
import type { ListQuery } from "./attachment.schema.js";

const withMessage = { messageAttachments: { select: { messageId: true } } } satisfies Prisma.AttachmentInclude;

const where = (conversationId: string, kind: ListQuery["kind"]): Prisma.AttachmentWhereInput => {
  const base: Prisma.AttachmentWhereInput = { conversationId, deletedAt: null, uploadStatus: "UPLOADED" };
  switch (kind) {
    case "image":
      return { ...base, mimeType: { startsWith: "image/" } };
    case "audio":
      return { ...base, mimeType: { startsWith: "audio/" } };
    case "video":
      return { ...base, mimeType: { startsWith: "video/" } };
    case "voice":
      return { ...base, messageAttachments: { some: { message: { messageType: "VOICE" } } } };
    case "document":
      return {
        ...base,
        NOT: [
          { mimeType: { startsWith: "image/" } },
          { mimeType: { startsWith: "audio/" } },
          { mimeType: { startsWith: "video/" } },
        ],
      };
    default:
      return base;
  }
};

export class AttachmentRepository {
  constructor(private readonly db: Db = prisma) {}

  /** A live (not deleted, fully uploaded) attachment with the message that carries it. */
  findLive(id: string) {
    return this.db.attachment.findFirst({
      where: { id, deletedAt: null, uploadStatus: "UPLOADED" },
      include: withMessage,
    });
  }

  /** A customer's uploaded file that no message carries yet (`POST /chat/attachments`). */
  findStaged(id: string, conversationId: string, uploadedById: string) {
    return this.db.attachment.findFirst({
      where: {
        id,
        conversationId,
        uploadedById,
        uploadedByType: "CUSTOMER",
        deletedAt: null,
        uploadStatus: "PENDING",
        messageAttachments: { none: {} },
      },
    });
  }

  /** Stores a customer's file metadata without a message. Invisible to every listing until a message claims it. */
  stage(data: {
    conversationId: string;
    uploadedById: string;
    storageKey: string;
    fileName: string;
    mimeType: string;
    fileSize: number;
    checksumSha256: string;
  }) {
    return this.db.attachment.create({
      data: {
        conversationId: data.conversationId,
        uploadedByType: "CUSTOMER",
        uploadedById: data.uploadedById,
        storageKey: data.storageKey,
        fileName: data.fileName,
        mimeType: data.mimeType,
        fileSize: BigInt(data.fileSize),
        checksumSha256: data.checksumSha256,
        uploadStatus: "PENDING",
      },
    });
  }

  /** The first audio attachment of a message that is not deleted. */
  findAudioOfMessage(messageId: string) {
    return this.db.attachment.findFirst({
      where: {
        deletedAt: null,
        uploadStatus: "UPLOADED",
        mimeType: { startsWith: "audio/" },
        messageAttachments: { some: { messageId, message: { deletedAt: null } } },
      },
      include: withMessage,
      orderBy: { createdAt: "asc" },
    });
  }

  async list(conversationId: string, query: ListQuery) {
    const filter = where(conversationId, query.kind);
    const [items, total] = await Promise.all([
      this.db.attachment.findMany({
        where: filter,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        ...pageArgs(query),
        include: withMessage,
      }),
      this.db.attachment.count({ where: filter }),
    ]);
    return { items, total };
  }

  /** Marks the file deleted. Returns false if someone else already did. */
  async softDelete(id: string): Promise<boolean> {
    const { count } = await this.db.attachment.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return count === 1;
  }
}
