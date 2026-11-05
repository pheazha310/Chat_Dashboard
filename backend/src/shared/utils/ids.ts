import { z } from "zod";

/** Ids are BigInt in PostgreSQL and strings in JSON (BigInt is not JSON-serializable). */
export const idToString = (id: bigint) => id.toString();

/** Positive integer id received as a string; parsed to BigInt. */
export const idSchema = z
  .string()
  .regex(/^[1-9]\d{0,17}$/, "Invalid id")
  .transform((value) => BigInt(value));

export const idParams = z.object({ id: idSchema });
