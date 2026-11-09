import { env } from "@config/env.js";
import type { Directory } from "@shared/ports/directory.js";
import { CachedDirectory } from "./cached-directory.js";
import { DevDirectory } from "./dev-directory.js";

/**
 * Picks the directory for BACKEND1_MODE. `local` (names from this backend's `users` table) is built by the caller,
 * since it needs the auth module's service.
 */
export function createDirectory(local: () => Directory): Directory {
  if (env.BACKEND1_MODE === "local") return new CachedDirectory(local());
  if (env.BACKEND1_MODE === "dev") return new CachedDirectory(new DevDirectory());
  throw new Error("BACKEND1_MODE=external is not implemented: the Backend 1 API contract has not been provided");
}
