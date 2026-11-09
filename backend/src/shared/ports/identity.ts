import type { AuthContext } from "@shared/auth/auth.types.js";

/** Maps a verified identity to this backend's own chat user. */
export interface IdentityResolver {
  /**
   * The internal chat user id and what the user's role may do (`module.action` names). Throws ForbiddenError when the
   * chat user is disabled.
   */
  resolve(auth: AuthContext): Promise<{ chatUserId: string; permissions?: ReadonlySet<string> }>;
}

/** Creates a customer's chat identity on demand, so rows that reference it (conversations) can be written. */
export interface CustomerIdentities {
  ensureCustomer(customerId: string): Promise<void>;
}
