import { prisma, type Db } from "@config/database.js";

export interface PreferencesRow {
  restoreTabs?: unknown;
  persistTabs?: unknown;
}

export class WorkspaceRepository {
  constructor(private readonly db: Db = prisma) {}

  async findPreferences(agentId: string): Promise<PreferencesRow> {
    const row = await this.db.workspacePreference.findUnique({ where: { agentId }, select: { settings: true } });
    return isRecord(row?.settings) ? row.settings : {};
  }

  /** Merges the given keys into the stored settings in one statement, so two windows saving at once keep both changes. */
  async mergePreferences(agentId: string, patch: Record<string, boolean>): Promise<PreferencesRow> {
    const rows = await this.db.$queryRaw<{ settings: unknown }[]>`
      INSERT INTO workspace_preferences (agent_id, settings, updated_at)
      VALUES (${agentId}::uuid, ${JSON.stringify(patch)}::jsonb, now())
      ON CONFLICT (agent_id) DO UPDATE
        SET settings = COALESCE(workspace_preferences.settings, '{}'::jsonb) || EXCLUDED.settings, updated_at = now()
      RETURNING settings`;
    const settings = rows[0]?.settings;
    return isRecord(settings) ? settings : {};
  }

  listTabs(agentId: string) {
    return this.db.workspaceOpenConversation.findMany({
      where: { agentId },
      orderBy: [{ sortOrder: "asc" }, { lastOpenedAt: "asc" }, { id: "asc" }],
    });
  }

  countTabs(agentId: string) {
    return this.db.workspaceOpenConversation.count({ where: { agentId } });
  }

  async hasTab(agentId: string, conversationId: string) {
    return (await this.db.workspaceOpenConversation.count({ where: { agentId, conversationId } })) > 0;
  }

  /**
   * Opens a tab, or just refreshes `last_opened_at` when it is already open (one tab per conversation, even when two
   * windows open it at the same moment). New tabs go after the existing ones.
   */
  async upsertTab(agentId: string, conversationId: string) {
    const rows = await this.db.$queryRaw<{ sort_order: number; last_opened_at: Date }[]>`
      INSERT INTO workspace_open_conversations (agent_id, conversation_id, sort_order, last_opened_at)
      SELECT ${agentId}::uuid, ${conversationId}::uuid, COALESCE(MAX(sort_order) + 1, 0), now()
        FROM workspace_open_conversations WHERE agent_id = ${agentId}::uuid
      ON CONFLICT (agent_id, conversation_id) DO UPDATE SET last_opened_at = now()
      RETURNING sort_order, last_opened_at`;
    const row = rows[0];
    if (!row) throw new Error("tab upsert returned no row");
    return { sortOrder: row.sort_order, lastOpenedAt: row.last_opened_at };
  }

  async deleteTab(agentId: string, conversationId: string) {
    const { count } = await this.db.workspaceOpenConversation.deleteMany({ where: { agentId, conversationId } });
    return count > 0;
  }

  listDrafts(agentId: string) {
    return this.db.conversationDraft.findMany({ where: { agentId }, orderBy: { updatedAt: "desc" } });
  }

  upsertDraft(agentId: string, conversationId: string, content: string) {
    return this.db.conversationDraft.upsert({
      where: { agentId_conversationId: { agentId, conversationId } },
      create: { agentId, conversationId, content },
      update: { content },
    });
  }

  async deleteDraft(agentId: string, conversationId: string) {
    const { count } = await this.db.conversationDraft.deleteMany({ where: { agentId, conversationId } });
    return count > 0;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
