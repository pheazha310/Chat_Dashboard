import type { AuthContext } from "@shared/auth/auth.types.js";
import { ConflictError } from "@shared/errors/AppError.js";
import type { ConversationAccess, ConversationSummaries } from "@shared/ports/conversation-access.js";
import type { RealtimeNotifier } from "@shared/ports/realtime.js";
import { bestEffort } from "@shared/utils/best-effort.js";
import { MAX_OPEN_TABS, type DraftInput, type PreferencesInput } from "./workspace.schema.js";
import type { PreferencesRow, WorkspaceRepository } from "./workspace.repository.js";
import type {
  DraftDto,
  OpenTabResult,
  WorkspaceDto,
  WorkspaceEvent,
  WorkspacePreferencesDto,
  WorkspaceTabDto,
} from "./workspace.types.js";

/**
 * The agent's workspace: which conversations are open as tabs, their unsent drafts and tab preferences.
 * This is per-agent UI state. Closing a tab never touches the conversation itself (status, assignment, messages).
 * Every change is pushed to all of the agent's other sessions so windows stay in step.
 */
export class WorkspaceService {
  constructor(
    private readonly repository: WorkspaceRepository,
    private readonly realtime: RealtimeNotifier,
    private readonly conversations: () => ConversationAccess & ConversationSummaries,
  ) {}

  async get(auth: AuthContext): Promise<WorkspaceDto> {
    const preferences = toPreferences(await this.repository.findPreferences(auth.userId));
    const [tabRows, draftRows] = await Promise.all([
      preferences.restoreTabs ? this.repository.listTabs(auth.userId) : [],
      this.repository.listDrafts(auth.userId),
    ]);
    const summaries = await this.conversations().visibleSummaries(auth, [
      ...tabRows.map((row) => row.conversationId),
      ...draftRows.map((row) => row.conversationId),
    ]);

    const tabs: WorkspaceTabDto[] = [];
    for (const row of tabRows) {
      const conversation = summaries.get(row.conversationId);
      if (conversation) {
        tabs.push({
          conversationId: row.conversationId,
          sortOrder: row.sortOrder,
          lastOpenedAt: row.lastOpenedAt.toISOString(),
          conversation,
        });
      }
    }
    const drafts: DraftDto[] = draftRows
      .filter((row) => summaries.has(row.conversationId))
      .map((row) => ({
        conversationId: row.conversationId,
        content: row.content,
        updatedAt: row.updatedAt.toISOString(),
      }));
    return { preferences, tabs, drafts };
  }

  async updatePreferences(auth: AuthContext, input: PreferencesInput): Promise<WorkspacePreferencesDto> {
    const patch: Record<string, boolean> = {};
    if (input.restoreTabs !== undefined) patch.restoreTabs = input.restoreTabs;
    if (input.persistTabs !== undefined) patch.persistTabs = input.persistTabs;
    const preferences = toPreferences(await this.repository.mergePreferences(auth.userId, patch));
    await this.publish(auth, { type: "workspace.preferences_updated", payload: { preferences } });
    return preferences;
  }

  /** Idempotent: opening an open tab only refreshes it, so two windows cannot create a duplicate. */
  async openTab(auth: AuthContext, conversationId: string): Promise<OpenTabResult> {
    await this.conversations().requireVisible(auth, conversationId);
    const { persistTabs } = toPreferences(await this.repository.findPreferences(auth.userId));
    if (!persistTabs) return { conversationId, persisted: false, sortOrder: null };

    if (
      !(await this.repository.hasTab(auth.userId, conversationId)) &&
      (await this.repository.countTabs(auth.userId)) >= MAX_OPEN_TABS
    ) {
      throw new ConflictError(`At most ${MAX_OPEN_TABS} tabs can be open; close one first`);
    }
    const tab = await this.repository.upsertTab(auth.userId, conversationId);
    await this.publish(auth, {
      type: "workspace.tab_opened",
      payload: { conversationId, sortOrder: tab.sortOrder, lastOpenedAt: tab.lastOpenedAt.toISOString() },
    });
    return { conversationId, persisted: true, sortOrder: tab.sortOrder };
  }

  /** Idempotent. Needs no conversation access: a tab for a conversation that became hidden must still be closable. */
  async closeTab(auth: AuthContext, conversationId: string): Promise<{ conversationId: string }> {
    if (await this.repository.deleteTab(auth.userId, conversationId)) {
      await this.publish(auth, { type: "workspace.tab_closed", payload: { conversationId } });
    }
    return { conversationId };
  }

  /** An empty draft is deleted instead of stored. */
  async saveDraft(auth: AuthContext, conversationId: string, input: DraftInput): Promise<DraftDto | null> {
    await this.conversations().requireVisible(auth, conversationId);
    if (input.content.length === 0) {
      await this.clearDraft(auth, conversationId);
      return null;
    }
    const row = await this.repository.upsertDraft(auth.userId, conversationId, input.content);
    const draft = { conversationId, content: row.content, updatedAt: row.updatedAt.toISOString() };
    await this.publish(auth, {
      type: "workspace.draft_updated",
      payload: { conversationId, content: draft.content, updatedAt: draft.updatedAt },
    });
    return draft;
  }

  /** Idempotent, and works for conversations the agent can no longer see. */
  async clearDraft(auth: AuthContext, conversationId: string): Promise<{ conversationId: string }> {
    if (await this.repository.deleteDraft(auth.userId, conversationId)) {
      await this.publish(auth, {
        type: "workspace.draft_updated",
        payload: { conversationId, content: null, updatedAt: new Date().toISOString() },
      });
    }
    return { conversationId };
  }

  private publish(auth: AuthContext, event: WorkspaceEvent) {
    return bestEffort(`realtime ${event.type}`, () => this.realtime.agentEvent(auth.userId, event.type, event.payload));
  }
}

function toPreferences(row: PreferencesRow): WorkspacePreferencesDto {
  return {
    restoreTabs: typeof row.restoreTabs === "boolean" ? row.restoreTabs : true,
    persistTabs: typeof row.persistTabs === "boolean" ? row.persistTabs : true,
  };
}
