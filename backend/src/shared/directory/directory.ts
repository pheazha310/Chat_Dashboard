import { env } from "@config/env.js";
import type { Directory } from "@shared/ports/directory.js";
import { CachedDirectory } from "./cached-directory.js";
import { DevDirectory } from "./dev-directory.js";

/** Single place to plug in the real Backend 1 client once its contract is provided. */
export function createDirectory(): Directory {
  if (env.BACKEND1_MODE === "dev") return new CachedDirectory(new DevDirectory());
  throw new Error("BACKEND1_MODE=external is not implemented: the Backend 1 API contract has not been provided");
}
