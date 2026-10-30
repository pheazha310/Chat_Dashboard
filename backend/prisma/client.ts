import "dotenv/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "./generated/prisma/client";

// Prisma 7 needs a driver adapter; @prisma/adapter-mariadb talks to MySQL and MariaDB.
// The adapter accepts the same mysql:// URL as DATABASE_URL.
const adapter = new PrismaMariaDb(process.env.DATABASE_URL ?? "");

export const prisma = new PrismaClient({ adapter });
