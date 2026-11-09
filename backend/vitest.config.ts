import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (dir: string) => fileURLToPath(new URL(`./src/${dir}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: { "@config": src("config"), "@modules": src("modules"), "@shared": src("shared"), "@lib": src("lib") },
  },
  test: {
    environment: "node",
    // Integration tests share one database and truncate it, so test files must not run in parallel.
    fileParallelism: false,
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // Wiring/infra with no unit-testable logic; repositories need a real DB (integration tests, not written yet).
      exclude: [
        "src/**/*.test.ts",
        "src/server.ts",
        "src/scripts/**",
        "src/app.ts",
        "src/routes.ts",
        "src/config/**",
        "src/websocket/**",
        "src/**/index.ts",
        "src/**/*.routes.ts",
        "src/**/*.repository.ts",
        "src/**/*.types.ts",
      ],
      thresholds: { lines: 70, functions: 70, statements: 70, branches: 65 },
    },
  },
});
