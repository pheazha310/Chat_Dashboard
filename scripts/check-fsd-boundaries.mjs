import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = path.join(root, "src");
const layers = ["app", "pages", "widgets", "features", "entities", "shared"];
const layerRank = new Map(layers.map((layer, index) => [layer, index]));
const extensions = [".ts", ".tsx", ".js", ".jsx"];

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(directory, entry.name);
      return entry.isDirectory() ? collect(fullPath) : /\.(ts|tsx|js|jsx)$/.test(entry.name) ? [fullPath] : [];
    }),
  );
  return files.flat();
}

async function resolveModule(basePath) {
  for (const candidate of [
    basePath,
    ...extensions.map((extension) => `${basePath}${extension}`),
    ...extensions.map((extension) => path.join(basePath, `index${extension}`)),
  ]) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {}
  }
  return null;
}

const violations = [];
for (const file of await collect(srcRoot)) {
  const sourceRelative = path.relative(srcRoot, file);
  const sourceParts = sourceRelative.split(path.sep);
  const sourceLayer = sourceParts[0];
  const sourceSegment = sourceLayer === "shared" ? "shared" : sourceParts.length > 2 ? sourceParts[1] : "_layer-entry";
  if (!layerRank.has(sourceLayer)) continue;

  const source = await readFile(file, "utf8");
  const imports = source.matchAll(/(?:from\s*|import\s*)["']([^"']+)["']/g);
  for (const [, specifier] of imports) {
    const targetBase = specifier.startsWith("@/")
      ? path.join(srcRoot, specifier.slice(2))
      : specifier.startsWith(".")
        ? path.resolve(path.dirname(file), specifier)
        : null;
    if (!targetBase) continue;

    const targetPath = await resolveModule(targetBase);
    if (!targetPath) continue;
    const targetParts = path.relative(srcRoot, targetPath).split(path.sep);
    const targetLayer = targetParts[0];
    const targetSegment = targetLayer === "shared" ? "shared" : targetParts[1];
    if (!layerRank.has(targetLayer)) continue;

    if (layerRank.get(sourceLayer) > layerRank.get(targetLayer)) {
      violations.push(
        `${sourceRelative}: lower layer '${sourceLayer}' imports higher layer '${targetLayer}' via '${specifier}'`,
      );
      continue;
    }

    if (
      sourceLayer === targetLayer &&
      sourceSegment !== targetSegment &&
      sourceSegment !== "_layer-entry" &&
      path.basename(targetPath) !== "index.ts" &&
      path.basename(targetPath) !== "index.tsx"
    ) {
      violations.push(
        `${sourceRelative}: import '${specifier}' from another ${sourceLayer} segment through its index.ts public API`,
      );
    }
  }
}

if (violations.length) {
  console.error("FSD boundary violations:\n" + violations.map((violation) => `- ${violation}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log("FSD import boundaries look good.");
}
