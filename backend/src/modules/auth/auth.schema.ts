import { z } from "zod";
import { idSchema } from "@shared/utils/ids.js";
import { pageQuery } from "@shared/utils/pagination.js";
import { ROLES } from "@shared/auth/auth.types.js";
import { STAFF_ROLES, USER_STATUSES } from "./auth.types.js";

/** Lower-cased and trimmed, so `Ann@Example.com` and `ann@example.com` are one account. */
export const emailSchema = z
  .string()
  .trim()
  .max(254)
  .pipe(z.email({ error: "Invalid email" }))
  .transform((value) => value.toLowerCase());

/** Length only (NIST 800-63B): at least 8 characters, at most 128 so hashing stays bounded. No composition rules. */
export const newPasswordSchema = z.string().min(8, "At least 8 characters").max(128, "At most 128 characters");
/** A password being checked, not set: any non-empty string up to the same bound. */
const passwordSchema = z.string().min(1).max(128);

const displayName = z.string().trim().min(1).max(100);

export const loginBody = z.object({ email: emailSchema, password: passwordSchema }).strict();
export type LoginInput = z.infer<typeof loginBody>;

export const registerBody = z.object({ email: emailSchema, password: newPasswordSchema, displayName }).strict();
export type RegisterInput = z.infer<typeof registerBody>;

export const refreshBody = z.object({ refreshToken: z.string().min(20).max(200) }).strict();

export const changePasswordBody = z
  .object({ currentPassword: passwordSchema, newPassword: newPasswordSchema })
  .strict()
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: "The new password must differ from the current one",
    path: ["newPassword"],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordBody>;

// ─── user management (admins) ──────────────────────────────────────────────

export const userParams = z.object({ userId: idSchema });

export const listUsersQuery = pageQuery.extend({
  q: z.string().trim().min(1).max(100).optional(),
  role: z.enum(ROLES).optional(),
  status: z.enum(USER_STATUSES).optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuery>;

export const createUserBody = z
  .object({ email: emailSchema, displayName, role: z.enum(STAFF_ROLES), password: newPasswordSchema })
  .strict();
export type CreateUserInput = z.infer<typeof createUserBody>;

export const updateUserBody = z
  .object({ displayName, role: z.enum(STAFF_ROLES), status: z.enum(USER_STATUSES) })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Send at least one field");
export type UpdateUserInput = z.infer<typeof updateUserBody>;

export const resetPasswordBody = z.object({ password: newPasswordSchema }).strict();
