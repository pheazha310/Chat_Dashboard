import "dotenv/config"; // Prisma 7 no longer loads .env on its own
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema", // one .prisma file per domain (see prisma/schema/schema.prisma)
  migrations: { path: "prisma/migrations" },
  datasource: {
    url: env("DATABASE_URL"), // postgresql://user:pass@host:5432/db
  },
});
