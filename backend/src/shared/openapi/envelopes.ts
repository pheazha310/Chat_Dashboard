import type { ZodType } from "zod";
import { z } from "zod";
import "./registry.js";

/** Response envelopes from docs/api-response-contracts.md, as OpenAPI schemas. */

export const successOf = <T extends ZodType>(data: T) => z.object({ status: z.literal("success"), data });

export const pageMeta = z.object({
  total: z.number().int(),
  page: z.number().int(),
  size: z.number().int(),
  totalPages: z.number().int(),
});

export const cursorMeta = z.object({
  limit: z.number().int(),
  hasMore: z.boolean(),
  direction: z.enum(["older", "newer"]),
  oldestSequence: z.string().nullable(),
  newestSequence: z.string().nullable(),
});

export const pagedOf = <T extends ZodType>(item: T) =>
  z.object({ status: z.literal("success"), data: z.array(item), meta: pageMeta });

export const cursorPagedOf = <T extends ZodType>(item: T) =>
  z.object({ status: z.literal("success"), data: z.array(item), meta: cursorMeta });

export const errorEnvelope = z
  .object({
    status: z.literal("error"),
    error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
  })
  .openapi("ErrorResponse");

const json = (schema: ZodType) => ({ content: { "application/json": { schema } } });

export const ok = (description: string, schema: ZodType) => ({ description, ...json(schema) });

/** Error responses shared by authenticated routes. */
export const errors = {
  400: { description: "Validation failed (`error.details` lists the zod issues)", ...json(errorEnvelope) },
  401: { description: "Missing or invalid bearer token", ...json(errorEnvelope) },
  403: { description: "Role or permission not sufficient", ...json(errorEnvelope) },
  404: { description: "Not found, or hidden from the caller", ...json(errorEnvelope) },
  409: { description: "Already in that state, or lost a race with another request", ...json(errorEnvelope) },
} as const;

export const jsonBody = (schema: ZodType) => ({ required: true, ...json(schema) });
