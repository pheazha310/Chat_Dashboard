import { prisma, type Db } from "@config/database.js";
import type { AuthContext } from "@shared/auth/auth.types.js";
import { can } from "@shared/auth/permissions.js";
import { escapeLike } from "@shared/utils/like.js";
import { pageArgs } from "@shared/utils/pagination.js";
import type { Prisma } from "../../../prisma/generated/prisma/client.js";
import type { ListQuery } from "./canned-response.schema.js";

/** What the caller may read: shared templates and their own personal ones. Nobody else's personal ones, ever. */
export const visibleTo = (auth: AuthContext): Prisma.CannedResponseWhereInput => ({
  OR: [{ scope: "SHARED" }, { scope: "PERSONAL", createdBy: auth.userId }],
});

/** What the caller may change: their own personal templates, and shared ones if they are a supervisor. */
export const manageableBy = (auth: AuthContext): Prisma.CannedResponseWhereInput => ({
  OR: [
    { scope: "PERSONAL", createdBy: auth.userId },
    ...(can(auth, "canned_responses.manage_shared") ? [{ scope: "SHARED" }] : []),
  ],
});

export class CannedResponseRepository {
  constructor(private readonly db: Db = prisma) {}

  async list(auth: AuthContext, query: ListQuery) {
    const and: Prisma.CannedResponseWhereInput[] = [visibleTo(auth)];
    // Deactivated templates are only shown to the people who could reactivate them.
    and.push(query.includeInactive ? { OR: [{ isActive: true }, manageableBy(auth)] } : { isActive: true });
    if (query.scope) and.push({ scope: query.scope });
    if (query.shortcut) and.push({ shortcut: { equals: query.shortcut, mode: "insensitive" } });
    if (query.q) {
      const text = { contains: escapeLike(query.q), mode: "insensitive" } as const;
      and.push({ OR: [{ title: text }, { content: text }, { shortcut: text }] });
    }
    const where = { AND: and };
    const [items, total] = await Promise.all([
      this.db.cannedResponse.findMany({ where, orderBy: [{ title: "asc" }, { id: "asc" }], ...pageArgs(query) }),
      this.db.cannedResponse.count({ where }),
    ]);
    return { items, total };
  }

  findById(id: string) {
    return this.db.cannedResponse.findUnique({ where: { id } });
  }

  create(data: { title: string; content: string; shortcut: string | null; scope: string; createdBy: string }) {
    return this.db.cannedResponse.create({ data });
  }

  update(id: string, data: Prisma.CannedResponseUncheckedUpdateInput) {
    return this.db.cannedResponse.update({ where: { id }, data });
  }

  /** Another active template the same people could confuse with this shortcut, if any. */
  findShortcutClash(scope: string, createdBy: string, shortcut: string, excludeId?: string) {
    return this.db.cannedResponse.findFirst({
      where: {
        isActive: true,
        shortcut: { equals: shortcut, mode: "insensitive" },
        ...(scope === "SHARED" ? { scope: "SHARED" } : { scope: "PERSONAL", createdBy }),
        ...(excludeId === undefined ? {} : { id: { not: excludeId } }),
      },
      select: { id: true },
    });
  }
}
