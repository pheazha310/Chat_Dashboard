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

/** A signed JWT from LOS; bounded so a huge body is refused before any crypto runs. */
const losToken = z.string().min(20).max(8192);
/** Mobile: the LOS customer access token the app already holds. */
export const losCustomerBody = z.object({ losToken }).strict();
/** Dashboard: the short-lived LOS staff hand-off token. */
export const losStaffBody = z.object({ handoffToken: losToken }).strict();

/** An LOS userId: a positive 32-bit integer, as LOS stores it. */
const losUserIdSchema = z
  .number()
  .int()
  .min(1)
  .max(2 ** 31 - 1);

/**
 * Development sign-in (`POST /api/v1/dev/login`, AUTH_MODE=dev only): the identity an LOS token would carry, sent
 * directly. `customer` → a CUSTOMER account; `staff` → `role` agent, supervisor or admin (any case; LOS_STAFF_ROLE_MAP
 * names are not used here).
 */
export const devLoginBody = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("customer"),
      userId: losUserIdSchema.default(1),
      username: displayName.default("Dev Customer"),
    })
    .strict(),
  z
    .object({
      type: z.literal("staff"),
      userId: losUserIdSchema.default(1),
      username: displayName.default("Dev Staff"),
      role: z
        .string()
        .trim()
        .transform((value) => value.toUpperCase())
        .pipe(z.enum(STAFF_ROLES))
        .default("AGENT"),
    })
    .strict(),
]);
export type DevLoginInput = z.infer<typeof devLoginBody>;

export const changePasswordBody = z
  .object({ currentPassword: passwordSchema, newPassword: newPasswordSchema })
  .strict()
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: "The new password must differ from the current one",
    path: ["newPassword"],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordBody>;

// ─── user management (admins) ──────────────────────────────────────────────

/** Optional text that can be cleared with null. */
const optionalText = (max: number) => z.string().trim().min(1).max(max).nullable();

/** The `staff` row: send only what changes; null clears a field. */
export const staffFieldsBody = z
  .object({
    employeeCode: optionalText(100),
    department: optionalText(100),
    maxConcurrentChats: z.number().int().min(1).max(1000).nullable(),
  })
  .partial()
  .strict();

/** The `customers` row: send only what changes; null clears a field. */
export const customerFieldsBody = z
  .object({
    phone: z
      .string()
      .trim()
      .regex(/^\+[1-9][0-9]{6,14}$/, "Use the international format, e.g. +85512345678")
      .nullable(),
    customerCode: optionalText(100),
    preferredLanguage: z
      .string()
      .trim()
      .max(10)
      .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, "A language tag such as km or en")
      .nullable(),
  })
  .partial()
  .strict();

export const userParams = z.object({ userId: idSchema });

export const listUsersQuery = pageQuery.extend({
  q: z.string().trim().min(1).max(100).optional(),
  role: z.enum(ROLES).optional(),
  status: z.enum(USER_STATUSES).optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuery>;

export const createUserBody = z
  .object({
    email: emailSchema,
    displayName,
    role: z.enum(STAFF_ROLES),
    password: newPasswordSchema,
    staff: staffFieldsBody.optional(),
  })
  .strict();
export type CreateUserInput = z.infer<typeof createUserBody>;

export const updateUserBody = z
  .object({
    displayName,
    role: z.enum(STAFF_ROLES),
    status: z.enum(USER_STATUSES),
    staff: staffFieldsBody,
    customer: customerFieldsBody,
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Send at least one field");
export type UpdateUserInput = z.infer<typeof updateUserBody>;

export const resetPasswordBody = z.object({ password: newPasswordSchema }).strict();
