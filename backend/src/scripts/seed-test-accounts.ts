/**
 * Creates fake accounts for trying the chat locally: one admin, one supervisor, two agents and two customers. The
 * Postman collection signs in with them (docs/postman/README.md).
 *
 *   pnpm --filter @chat-dashboard/backend user:seed-test
 *   SEED_PASSWORD='another-pass' pnpm --filter @chat-dashboard/backend user:seed-test
 *
 * Every account gets the same password (SEED_PASSWORD, default `password123`). Accounts whose email already exists are
 * left unchanged, so the script can be re-run. Refuses to run with NODE_ENV=production.
 */
import { prisma } from "@config/database.js";
import { env } from "@config/env.js";
import { AuthRepository } from "@modules/auth/auth.repository.js";
import { newPasswordSchema } from "@modules/auth/auth.schema.js";
import { UserService } from "@modules/auth/user.service.js";
import { ChatIdentityRepository, ChatIdentityService } from "@modules/chat-identity/index.js";
import type { Role } from "@shared/auth/auth.types.js";
import { ConflictError } from "@shared/errors/AppError.js";

export const TEST_ACCOUNTS: ReadonlyArray<{ email: string; displayName: string; role: Role }> = [
  { email: "admin@test.local", displayName: "Chat Admin", role: "ADMIN" },
  { email: "supervisor@test.local", displayName: "Supervisor Srey", role: "SUPERVISOR" },
  { email: "agent1@test.local", displayName: "Agent Sophea", role: "AGENT" },
  { email: "agent2@test.local", displayName: "Agent Rithy", role: "AGENT" },
  { email: "customer1@test.local", displayName: "Dara", role: "CUSTOMER" },
  { email: "customer2@test.local", displayName: "Bopha", role: "CUSTOMER" },
];

async function main() {
  if (env.NODE_ENV === "production") {
    console.error("Refusing to create test accounts with NODE_ENV=production.");
    process.exitCode = 1;
    return;
  }
  const password = newPasswordSchema.safeParse(process.env.SEED_PASSWORD ?? "password123");
  if (!password.success) {
    console.error("SEED_PASSWORD must be 8-128 characters.");
    process.exitCode = 1;
    return;
  }

  const users = new UserService(new AuthRepository(), new ChatIdentityService(new ChatIdentityRepository()));
  for (const account of TEST_ACCOUNTS) {
    try {
      const user = await users.bootstrapAccount({ ...account, password: password.data });
      console.log(`created  ${account.role.padEnd(10)} ${user.email} (${user.id})`);
    } catch (error) {
      if (!(error instanceof ConflictError)) throw error;
      console.log(`exists   ${account.role.padEnd(10)} ${account.email}`);
    }
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
