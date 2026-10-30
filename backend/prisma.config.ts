import "dotenv/config"; // Prisma 7 no longer loads .env on its own
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"), // mysql://user:pass@host:3306/db
  },
});
