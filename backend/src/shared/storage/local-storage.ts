import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";
import type { Storage } from "./storage.js";

/** Files on the local disk under one root directory. For development and single-server deployments. */
export class LocalStorage implements Storage {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  /** Turns a key into a path inside the root; anything that could escape it is refused. */
  private pathFor(key: string): string {
    const clean = normalize(key);
    if (isAbsolute(clean) || clean.split(sep).includes("..") || clean === ".") {
      throw new Error("Invalid storage key");
    }
    return join(this.root, clean);
  }

  async put(key: string, data: Buffer): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    // Written beside the target and renamed, so a crash never leaves a half-written file under the real name.
    const temp = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, data, { flag: "wx" });
      await rename(temp, path);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
  }

  async stat(key: string) {
    try {
      const info = await stat(this.pathFor(key));
      return info.isFile() ? { size: info.size } : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  open(key: string, range?: { start: number; end: number }) {
    return createReadStream(this.pathFor(key), range);
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }
}
