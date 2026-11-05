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
      "Access token issued by Backend 1. Until its contract is provided, AUTH_MODE=dev accepts `dev:<userId>:<ROLE>`.",
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
        "Chat backend: conversations, assignments and messages. Identity, customers and loan data live in Backend 1.",
    },
    servers: [{ url: "/api/v1/admin" }],
  });
