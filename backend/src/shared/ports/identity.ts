import type { AuthContext } from "@shared/auth/auth.types.js";

/** Maps a verified Backend 1 identity to this backend's own chat user. */
export interface IdentityResolver {
  /** The internal chat user id. Throws ForbiddenError when the chat user is disabled. */
  resolve(auth: AuthContext): Promise<{ chatUserId: string }>;
}
