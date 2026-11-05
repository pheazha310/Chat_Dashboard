import type { Request, RequestHandler } from "express";
import type { ZodType, output } from "zod";
import { BadRequestError } from "@shared/errors/AppError.js";

type Schemas = { body?: ZodType; query?: ZodType; params?: ZodType };

export function validate(schemas: Schemas): RequestHandler {
  return (req, _res, next) => {
    for (const key of ["params", "query", "body"] as const) {
      const schema = schemas[key];
      if (!schema) continue;
      const result = schema.safeParse(req[key]);
      if (!result.success) {
        next(new BadRequestError("Validation failed", result.error.issues));
        return;
      }
      // Express 5 makes req.query a getter, so replace it instead of assigning.
      Object.defineProperty(req, key, { value: result.data, writable: true, configurable: true, enumerable: true });
    }
    next();
  };
}

/**
 * The typed result of `validate()`: `validate` replaces req.params/query/body with the parsed value, but Express still
 * types them loosely. Pass the same schema used on the route so the cast stays tied to it.
 */
export const parsed = <S extends ZodType>(req: Request, key: "params" | "query" | "body", _schema: S) =>
  req[key] as output<S>;
