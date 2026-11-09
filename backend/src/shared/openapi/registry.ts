import { extendZodWithOpenApi, OpenAPIRegistry, OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

// Adds `.openapi()` to zod schemas. Must run before any schema calls it, so every .openapi.ts imports from here.
extendZodWithOpenApi(z);

export const BEARER_AUTH = "bearerAuth";

export const createRegistry = () => {
  const registry = new OpenAPIRegistry();
  registry.registerComponent("securitySchemes", BEARER_AUTH, {
    type: "http",
    scheme: "bearer",
    description:
      "Access token from `POST /auth/login` or `POST /auth/refresh` (a 15-minute JWT). AUTH_MODE=dev also accepts `dev:<userId>:<ROLE>`.",
  });
  return registry;
};

export const generateDocument = (registry: OpenAPIRegistry) =>
  new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: "3.1.0",
    info: {
      title: "Chat Dashboard API (Backend 2)",
      version: "1.0.0",
      description:
        "Chat backend: sign-in and accounts, conversations, assignments and messages. Loan data lives in Backend 1.",
    },
    servers: [{ url: "/api/v1/admin" }],
  });
