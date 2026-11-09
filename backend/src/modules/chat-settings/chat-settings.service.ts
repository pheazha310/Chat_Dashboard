import type { AuthContext } from "@shared/auth/auth.types.js";
import type { RealtimeNotifier } from "@shared/ports/realtime.js";
import { bestEffort } from "@shared/utils/best-effort.js";
import type { ChatSettingsRepository } from "./chat-settings.repository.js";
import type { ChatSettingsInput } from "./chat-settings.schema.js";
import { DEFAULT_CHAT_SETTINGS, type ChatSettingsDto, type ChatSettingsPatch } from "./chat-settings.types.js";

/**
 * An agent's own chat switches. Every call is scoped to the caller: there is no way to read or change another
 * agent's settings, so no extra permission rule is needed. Changes are pushed to the agent's other sessions.
 */
export class ChatSettingsService {
  constructor(
    private readonly repository: ChatSettingsRepository,
    private readonly realtime: RealtimeNotifier,
  ) {}

  async get(auth: AuthContext): Promise<ChatSettingsDto> {
    return (await this.repository.find(auth.userId)) ?? { ...DEFAULT_CHAT_SETTINGS };
  }

  /** Partial update. Sending only values the agent already has changes and broadcasts nothing. */
  async update(auth: AuthContext, input: ChatSettingsInput): Promise<ChatSettingsDto> {
    const patch = definedOnly(input);
    const current = await this.get(auth);
    const changed = (Object.keys(patch) as (keyof ChatSettingsDto)[]).some((key) => patch[key] !== current[key]);
    if (!changed) return current;

    const settings = await this.repository.upsert(auth.userId, patch);
    await bestEffort("realtime chat_settings.updated", () =>
      this.realtime.agentEvent(auth.userId, "chat_settings.updated", { settings }),
    );
    return settings;
  }
}

function definedOnly(input: ChatSettingsInput): ChatSettingsPatch {
  const patch: ChatSettingsPatch = {};
  for (const [key, value] of Object.entries(input) as [keyof ChatSettingsDto, boolean | undefined][]) {
    if (value !== undefined) patch[key] = value;
  }
  return patch;
}
