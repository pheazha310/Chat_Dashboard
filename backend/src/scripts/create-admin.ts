/**
 * Creates an ADMIN account, for the first sign-in on a new installation (later admins are created in the dashboard).
 *
 *   ADMIN_USERNAME=admin ADMIN_NAME="Ops Admin" ADMIN_PASSWORD='…' \
 *     pnpm --filter @chat-dashboard/backend user:create-admin
 *
 * Reads DATABASE_URL like the API. The password is taken from the environment (not an argument) so it does not end up
 * in shell history or the process list; clear it afterwards.
 */
import { prisma } from "@config/database.js";
import { AuthRepository } from "@modules/auth/auth.repository.js";
import { createUserBody } from "@modules/auth/auth.schema.js";
import { UserService } from "@modules/auth/user.service.js";
import { ChatIdentityRepository, ChatIdentityService } from "@modules/chat-identity/index.js";

async function main() {
  const input = createUserBody.safeParse({
    username: process.env.ADMIN_USERNAME,
    email: process.env.ADMIN_EMAIL,
    displayName: process.env.ADMIN_NAME ?? "Administrator",
    password: process.env.ADMIN_PASSWORD,
    role: "ADMIN",
  });
  if (!input.success) {
    console.error("Set ADMIN_USERNAME and ADMIN_PASSWORD (8-128 characters); ADMIN_NAME and ADMIN_EMAIL are optional.");
    for (const issue of input.error.issues) console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    process.exitCode = 1;
    return;
  }
  const users = new UserService(new AuthRepository(), new ChatIdentityService(new ChatIdentityRepository()));
  const admin = await users.bootstrapAdmin(input.data);
  console.log(`Created admin ${admin.username} (${admin.id}).`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
