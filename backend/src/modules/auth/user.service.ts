import { logger } from "@config/logger.js";
import type { AuthContext, Role } from "@shared/auth/auth.types.js";
import { can } from "@shared/auth/permissions.js";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "@shared/errors/AppError.js";
import type { AgentProfile, CustomerProfile, Directory } from "@shared/ports/directory.js";
import { pageMeta } from "@shared/utils/pagination.js";
import { NO_AUDIT, type AuthAuditLog } from "./auth.audit.js";
import { hashPassword } from "./auth.password.js";
import { isUniqueViolation, isUniqueViolationOn, type AuthRepository, type IdentityRef } from "./auth.repository.js";
import type { CreateUserInput, ListUsersQuery, UpdateUserInput } from "./auth.schema.js";
import {
  STAFF_ROLES,
  isStaffRole,
  toUser,
  type StaffFields,
  type UserDto,
  type UserRow,
  type UserStatus,
} from "./auth.types.js";

/**
 * Told about account changes so the chat identity (`chat_users`) follows: disabled or re-enabled (requests with an older
 * access token are refused too), and created, renamed or given another role (`username`, `role_id`).
 */
export interface AccountStatusListener {
  setStatus(user: { id: string; role: Role }, status: UserStatus): Promise<void>;
  sync(user: { id: string; role: Role; displayName: string }): Promise<void>;
}

/**
 * Account management. Supervisors and admins can read accounts; only admins create staff, change roles, disable
 * accounts or set a password. An admin cannot change their own role or status (so nobody locks themselves out), and
 * a customer account cannot become staff or the other way round. Each account has a profile row (`staff` or
 * `customers`) created with it; admins edit it through `PATCH /users/:userId`.
 */
export class UserService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly status: AccountStatusListener,
    private readonly audit: AuthAuditLog = NO_AUDIT,
  ) {}

  async list(auth: AuthContext, query: ListUsersQuery) {
    requireSupervisor(auth);
    const { items, total } = await this.repository.listUsers(query);
    return { items: items.map(toUser), meta: pageMeta(total, query) };
  }

  async get(auth: AuthContext, userId: string): Promise<UserDto> {
    requireSupervisor(auth);
    return toUser(await this.find(userId));
  }

  async create(auth: AuthContext, input: CreateUserInput): Promise<UserDto> {
    requireAdmin(auth);
    return toUser(await this.createAccount({ ...input, createdBy: auth.userId }));
  }

  /** Creates the first admin from the command line (`pnpm --filter @chat-dashboard/backend user:create-admin`). */
  async bootstrapAdmin(input: {
    username: string;
    email?: string | undefined;
    displayName: string;
    password: string;
  }): Promise<UserDto> {
    return this.bootstrapAccount({ ...input, role: "ADMIN" });
  }

  /** Creates an account of any role from the command line, without a signed-in admin (first admin, test accounts). */
  async bootstrapAccount(input: {
    username: string;
    email?: string | undefined;
    displayName: string;
    password: string;
    role: Role;
  }): Promise<UserDto> {
    return toUser(await this.createAccount({ ...input, createdBy: null }));
  }

  async update(auth: AuthContext, userId: string, input: UpdateUserInput): Promise<UserDto> {
    requireAdmin(auth);
    const user = await this.find(userId);
    if (user.id === auth.userId && (input.role !== undefined || input.status !== undefined)) {
      throw new ForbiddenError("You cannot change your own role or status");
    }
    if (input.role !== undefined && !isStaffRole(user.role)) {
      throw new BadRequestError("A customer account cannot be given a staff role");
    }
    if (input.staff !== undefined && !isStaffRole(user.role)) {
      throw new BadRequestError("Staff fields belong to staff accounts; this is a customer account");
    }
    if (input.customer !== undefined && isStaffRole(user.role)) {
      throw new BadRequestError("Customer fields belong to customer accounts; this is a staff account");
    }
    // LOS sets an LOS account's role on every sign-in, so a role set here would be undone at the next one.
    if (input.role !== undefined && input.role !== user.role && user.losUserId !== null) {
      throw new ConflictError("This account's role is managed in LOS");
    }
    const roleChanged = input.role !== undefined && input.role !== user.role;
    const statusChanged = input.status !== undefined && input.status !== user.status;

    const updated = await withProfileConflicts(() =>
      this.repository.inTransaction(async (tx) => {
        const row = await tx.updateUser(user.id, {
          ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
          ...(input.role === undefined ? {} : { role: input.role }),
          ...(input.status === undefined ? {} : { status: input.status }),
          // Re-enabling also clears a sign-in lock.
          ...(statusChanged && input.status === "ACTIVE" ? { lockedUntil: null, failedLoginCount: 0 } : {}),
          ...(input.staff === undefined ? {} : { staff: input.staff }),
          ...(input.customer === undefined ? {} : { customer: input.customer }),
        });
        // A new role or a disabled account: every session signs in again (and so gets a token with the new role).
        if (roleChanged || (statusChanged && input.status === "DISABLED")) await tx.revokeAllForUser(user.id);
        return row;
      }),
    );
    if (statusChanged) await this.notifyStatus(updated);
    if (roleChanged || (statusChanged && input.status === "DISABLED")) {
      await this.audit.record({
        event: "SESSIONS_REVOKED",
        provider: "CHAT",
        outcome: "SUCCESS",
        userId: user.id,
        actorId: auth.userId,
        reason: statusChanged && input.status === "DISABLED" ? "DISABLED" : "ROLE_CHANGED",
      });
    }
    if (roleChanged || updated.displayName !== user.displayName) await this.syncIdentity(updated);
    return toUser(updated);
  }

  /**
   * Maps an existing chat account to an LOS identity, so that person's LOS sign-in lands in this account instead of a
   * new one. Explicit and admin-only: nothing is matched by name, email or phone. LOS then manages the account's role
   * (it is set from LOS on every LOS sign-in).
   */
  async linkIdentity(
    auth: AuthContext,
    userId: string,
    input: {
      provider: IdentityRef["provider"];
      externalUserType: IdentityRef["externalUserType"];
      externalUserId: number;
    },
  ): Promise<UserDto> {
    requireAdmin(auth);
    const user = await this.find(userId);
    if ((input.externalUserType === "CUSTOMER") !== (user.role === "CUSTOMER")) {
      throw new BadRequestError("The identity type does not match the account's kind");
    }
    if (user.losUserId !== null) throw new ConflictError("This account is already linked to an LOS identity");
    try {
      await this.repository.linkIdentity(
        user.id,
        {
          provider: input.provider,
          externalUserType: input.externalUserType,
          externalUserId: String(input.externalUserId),
        },
        auth.userId,
      );
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictError("This LOS identity is already linked to an account");
      throw error;
    }
    await this.audit.record({
      event: "IDENTITY_LINKED",
      provider: input.provider,
      outcome: "SUCCESS",
      userId: user.id,
      actorId: auth.userId,
    });
    return toUser(await this.find(user.id));
  }

  /** Removes the LOS mapping and signs the account out everywhere. Refused when it would leave no way to sign in. */
  async unlinkIdentity(auth: AuthContext, userId: string, provider: IdentityRef["provider"]): Promise<UserDto> {
    requireAdmin(auth);
    const user = await this.find(userId);
    if (user.losUserId === null) throw new NotFoundError("This account has no LOS identity");
    if (user.username === null) throw new ConflictError("LOS is this account's only sign-in, so it cannot be unlinked");
    await this.repository.inTransaction(async (tx) => {
      await tx.unlinkIdentity(user.id, provider);
      await tx.revokeAllForUser(user.id);
    });
    await this.audit.record({
      event: "IDENTITY_UNLINKED",
      provider,
      outcome: "SUCCESS",
      userId: user.id,
      actorId: auth.userId,
    });
    return toUser(await this.find(user.id));
  }

  /** Copies the name and role to the chat identity. Best effort: the next sign-in or request repeats it. */
  private async syncIdentity(user: UserRow) {
    try {
      await this.status.sync({ id: user.id, role: user.role as Role, displayName: user.displayName });
    } catch (error) {
      logger.error({ err: error, userId: user.id }, "could not sync the account to chat_users");
    }
  }

  /** The role and status an access token is checked against (`AccountCheckedAuthClient`). */
  async account(userId: string): Promise<{ role: string; status: string } | null> {
    const user = await this.repository.findUserById(userId);
    return user && { role: user.role, status: user.status };
  }

  /**
   * Mirrors the new status into the chat identity (which also covers `dev:` tokens). Runs after the change is committed;
   * if it fails the change still stands, and access tokens are refused anyway because they are checked against `users`.
   */
  private async notifyStatus(user: UserRow) {
    try {
      await this.status.setStatus({ id: user.id, role: user.role as Role }, user.status as UserStatus);
    } catch (error) {
      logger.error(
        { err: error, userId: user.id, status: user.status },
        "could not mirror account status to chat_users",
      );
    }
  }

  /** Sets a new password for someone who forgot theirs, and signs them out everywhere. */
  async resetPassword(auth: AuthContext, userId: string, password: string, username?: string): Promise<UserDto> {
    requireAdmin(auth);
    const user = await this.find(userId);
    // A password needs a username to sign in with. An LOS-only account has none: `username` gives it one (and so
    // standalone access on the same account); an account that has one is never renamed here.
    if (user.username === null && username === undefined) {
      throw new ConflictError(
        "This account signs in with LOS and has no password; send a username to give it chat credentials",
      );
    }
    if (user.username !== null && username !== undefined)
      throw new BadRequestError("This account already has a username");
    const passwordHash = await hashPassword(password);
    try {
      await this.repository.inTransaction(async (tx) => {
        if (user.username === null && username !== undefined) await tx.setCredentials(user.id, username, passwordHash);
        else await tx.setPassword(user.id, passwordHash);
        await tx.revokeAllForUser(user.id);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictError("An account with this username already exists");
      throw error;
    }
    return toUser({ ...user, ...(username === undefined ? {} : { username }), failedLoginCount: 0, lockedUntil: null });
  }

  // ─── Directory lookups (BACKEND1_MODE=local) ───────────────────────────────

  async customerProfile(customerId: string): Promise<CustomerProfile | null> {
    const [user] = await this.repository.findUsersByIds([customerId], ["CUSTOMER"]);
    if (!user) return null;
    return {
      id: user.id,
      name: user.displayName,
      avatarUrl: null,
      blacklisted: null,
      email: user.email,
      phone: user.customer?.phone ?? null,
      nationalId: null,
      occupation: null,
      salary: null,
    };
  }

  async agentProfiles(agentIds: string[]): Promise<AgentProfile[]> {
    const users = await this.repository.findUsersByIds([...new Set(agentIds)], [...STAFF_ROLES]);
    return users.map((user) => ({ id: user.id, name: user.displayName, avatarUrl: null }));
  }

  private async createAccount(input: {
    username: string;
    email?: string | undefined;
    displayName: string;
    role: string;
    password: string;
    createdBy: string | null;
    staff?: Partial<StaffFields> | undefined;
  }): Promise<UserRow> {
    const passwordHash = await hashPassword(input.password);
    const user = await withProfileConflicts(async () => {
      try {
        return await this.repository.createUser({
          username: input.username,
          ...(input.email === undefined ? {} : { email: input.email }),
          displayName: input.displayName,
          role: input.role,
          passwordHash,
          createdBy: input.createdBy,
          ...(input.staff === undefined ? {} : { staff: input.staff }),
        });
      } catch (error) {
        if (isUniqueViolation(error) && !isProfileViolation(error)) {
          throw new ConflictError("An account with this username already exists");
        }
        throw error;
      }
    });
    await this.syncIdentity(user);
    return user;
  }

  private async find(userId: string): Promise<UserRow> {
    const user = await this.repository.findUserById(userId);
    if (!user) throw new NotFoundError("User not found");
    return user;
  }
}

const isProfileViolation = (error: unknown) =>
  isUniqueViolationOn(error, "employee_code") || isUniqueViolationOn(error, "customer_code");

/** A taken employee or customer code is a 409 that says which. */
async function withProfileConflicts<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (isUniqueViolationOn(error, "employee_code")) throw new ConflictError("This employee code is already in use");
    if (isUniqueViolationOn(error, "customer_code")) throw new ConflictError("This customer code is already in use");
    throw error;
  }
}

function requireSupervisor(auth: AuthContext) {
  if (!can(auth, "users.read")) throw new ForbiddenError("You are not allowed to view accounts");
}

function requireAdmin(auth: AuthContext) {
  if (!can(auth, "users.manage")) throw new ForbiddenError("You are not allowed to manage accounts");
}

/** `Directory` backed by the `users` table: names for the inbox, the customer panel and agent lists. */
export class UserDirectory implements Directory {
  readonly source = "local";

  constructor(private readonly users: UserService) {}

  getCustomer(customerId: string) {
    return this.users.customerProfile(customerId);
  }

  getAgents(agentIds: string[]) {
    return this.users.agentProfiles(agentIds);
  }
}
