export type CannedScope = "PERSONAL" | "SHARED" | "TEAM";

/** A reusable reply. The dashboard puts its text into the composer; the agent edits it and sends it as a normal message. */
export interface CannedResponseDto {
  id: string;
  title: string;
  content: string;
  /** For quick insertion, like `/greeting`. Unique among the templates the agent can see. */
  shortcut: string | null;
  /** PERSONAL: only its creator. SHARED: every dashboard user. */
  scope: CannedScope;
  /** Backend 1 id of the agent who created it. */
  createdBy: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  /** Whether the caller may change or deactivate it. */
  permissions: { canEdit: boolean };
}
