import { z } from "zod";

/** Ids are UUIDs in PostgreSQL and in JSON, so they pass through unchanged. */
export const idToString = (id: string) => id;

/** UUID id received as a string, normalized to lower case so ids compare and cache consistently. */
export const idSchema = z.uuid({ error: "Invalid id" }).transform((value) => value.toLowerCase());

export const idParams = z.object({ id: idSchema });
