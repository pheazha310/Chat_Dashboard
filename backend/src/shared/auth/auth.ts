import { env } from "@config/env.js";
import type { AuthClient } from "./auth.types.js";
import { DevAuthClient } from "./dev-auth-client.js";

/** Single place to plug in the real Backend 1 client once its contract is provided. */
export function createAuthClient(): AuthClient {
  if (env.AUTH_MODE === "dev") return new DevAuthClient();
  throw new Error("AUTH_MODE=external is not implemented: the Backend 1 auth contract has not been provided");
}

export const authClient: AuthClient = createAuthClient();
