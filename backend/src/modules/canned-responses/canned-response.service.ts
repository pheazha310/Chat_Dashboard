import { ConflictError, ForbiddenError, NotFoundError } from "@shared/errors/AppError.js";
import { isSupervisor, type AuthContext } from "@shared/auth/auth.types.js";
import { idToString } from "@shared/utils/ids.js";
import { pageMeta } from "@shared/utils/pagination.js";
import type { CannedResponse } from "../../../prisma/generated/prisma/client.js";
import type { CannedResponseRepository } from "./canned-response.repository.js";
import type { CreateInput, ListQuery, UpdateInput } from "./canned-response.schema.js";
import type { CannedResponseDto, CannedScope } from "./canned-response.types.js";

/**
 * Saved reply templates. A PERSONAL template belongs to one agent and nobody else can read or change it (not even a
 * supervisor). A SHARED template is readable by every dashboard user and managed by supervisors. Templates are never
 * deleted, only deactivated. Selecting a template never sends anything: the dashboard puts the text in the composer.
 * TEAM templates are not available until Backend 1 can say who is on which team.
 */
export class CannedResponseService {
  constructor(private readonly repository: CannedResponseRepository) {}

  async list(auth: AuthContext, query: ListQuery) {
    const { items, total } = await this.repository.list(auth, query);
    return { items: items.map((row) => toDto(row, auth)), meta: pageMeta(total, query) };
  }

  async get(auth: AuthContext, id: string): Promise<CannedResponseDto> {
    return toDto(await this.requireVisible(auth, id), auth);
  }

  async create(auth: AuthContext, input: CreateInput): Promise<CannedResponseDto> {
    if (input.scope === "SHARED" && !isSupervisor(auth)) {
      throw new ForbiddenError("Only a supervisor can create a shared template");
    }
    if (input.shortcut !== undefined) await this.requireFreeShortcut(input.scope, auth.userId, input.shortcut);
    const created = await this.repository.create({
      title: input.title,
      content: input.content,
      shortcut: input.shortcut ?? null,
      scope: input.scope,
      createdBy: auth.userId,
    });
    return toDto(created, auth);
  }

  async update(auth: AuthContext, id: string, input: UpdateInput): Promise<CannedResponseDto> {
    const existing = await this.requireManageable(auth, id);
    const shortcut = input.shortcut === undefined ? existing.shortcut : input.shortcut;
    const active = input.isActive ?? existing.isActive;
    // A shortcut only needs to be free while the template is active (and when it changes or comes back).
    if (shortcut !== null && active && (shortcut !== existing.shortcut || !existing.isActive)) {
      await this.requireFreeShortcut(existing.scope as CannedScope, existing.createdBy, shortcut, id);
    }
    const updated = await this.repository.update(id, {
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.content === undefined ? {} : { content: input.content }),
      ...(input.shortcut === undefined ? {} : { shortcut: input.shortcut }),
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
    });
    return toDto(updated, auth);
  }

  /** Deactivates the template. It stays in the database and can be reactivated. Repeating it changes nothing. */
  async deactivate(auth: AuthContext, id: string): Promise<CannedResponseDto> {
    const existing = await this.requireManageable(auth, id);
    if (!existing.isActive) return toDto(existing, auth);
    return toDto(await this.repository.update(id, { isActive: false }), auth);
  }

  /** A template the caller may read; someone else's personal template looks like a missing one. */
  private async requireVisible(auth: AuthContext, id: string): Promise<CannedResponse> {
    const row = await this.repository.findById(id);
    if (!row || !canRead(auth, row)) throw new NotFoundError("Template not found");
    return row;
  }

  private async requireManageable(auth: AuthContext, id: string): Promise<CannedResponse> {
    const row = await this.requireVisible(auth, id);
    if (!canManage(auth, row)) throw new ForbiddenError("Only a supervisor can change a shared template");
    return row;
  }

  private async requireFreeShortcut(scope: CannedScope, createdBy: string, shortcut: string, excludeId?: string) {
    if (await this.repository.findShortcutClash(scope, createdBy, shortcut, excludeId)) {
      throw new ConflictError(`The shortcut ${shortcut} is already used by another template`);
    }
  }
}

const mine = (auth: AuthContext, row: CannedResponse) => row.createdBy === auth.userId;

function canRead(auth: AuthContext, row: CannedResponse) {
  if (row.scope === "SHARED") return row.isActive || isSupervisor(auth);
  return row.scope === "PERSONAL" && mine(auth, row);
}

function canManage(auth: AuthContext, row: CannedResponse) {
  return row.scope === "SHARED" ? isSupervisor(auth) : row.scope === "PERSONAL" && mine(auth, row);
}

const toDto = (row: CannedResponse, auth: AuthContext): CannedResponseDto => ({
  id: idToString(row.id),
  title: row.title,
  content: row.content,
  shortcut: row.shortcut,
  scope: row.scope as CannedScope,
  createdBy: idToString(row.createdBy),
  isActive: row.isActive,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  permissions: { canEdit: canManage(auth, row) },
});
