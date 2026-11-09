import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { BEARER_AUTH } from "@shared/openapi/registry.js";
import { errors, ok, pagedOf, successOf } from "@shared/openapi/envelopes.js";
import { idParams } from "@shared/utils/ids.js";
import { pageQuery } from "@shared/utils/pagination.js";
import type { CustomerDto, ParticipantDto } from "./customer.types.js";

const nullableString = z.string().nullable();

// `satisfies` keeps the schemas in step with the TypeScript DTOs: drift fails the build.
const customer = z
  .object({
    id: z.string(),
    name: z.string(),
    avatarUrl: nullableString,
    blacklisted: z.boolean().nullable(),
    email: nullableString,
    phone: nullableString,
    nationalId: nullableString,
    occupation: nullableString,
    salary: nullableString,
    restricted: z.array(z.string()),
    source: z.string(),
  })
  .openapi("Customer") satisfies z.ZodType<CustomerDto>;

const participant = z
  .object({
    participantType: z.enum(["CUSTOMER", "AGENT", "ASSISTANT"]),
    participantId: nullableString,
    role: z.enum(["OWNER", "VIEWER", "MEMBER"]),
    joinedAt: z.string(),
    leftAt: nullableString,
    profile: z.object({ name: z.string(), avatarUrl: nullableString }).nullable(),
  })
  .openapi("Participant") satisfies z.ZodType<ParticipantDto>;

const security = [{ [BEARER_AUTH]: [] }];
const tags = ["Customer information"];
const failures = { 400: errors[400], 401: errors[401], 403: errors[403], 404: errors[404] };

export function registerCustomerOpenApi(registry: OpenAPIRegistry) {
  registry.registerPath({
    method: "get",
    path: "/conversations/{id}/customer",
    tags,
    security,
    summary: "Customer profile",
    description:
      "Fetched from Backend 1 for the conversation's customer. Fields the caller may not see are null and listed in `restricted`: contact details (email, phone) need the owner or a supervisor; national id, occupation and salary need a supervisor. This policy is provisional until Backend 1 defines its permissions. `source: dev-stub` means placeholder data.",
    request: { params: idParams },
    responses: {
      200: ok("The customer", successOf(customer)),
      ...failures,
      503: { description: "Backend 1 is unreachable", content: errors[404].content },
    },
  });
  registry.registerPath({
    method: "get",
    path: "/conversations/{id}/customer/conversations",
    tags,
    security,
    summary: "The customer's other conversations",
    description: "Newest first, including archived and closed, limited to ones the caller is allowed to see.",
    request: { params: idParams, query: pageQuery },
    responses: {
      200: ok(
        "A page of the customer's other conversations",
        pagedOf(z.object({ id: z.string() }).passthrough().openapi("OtherConversation")),
      ),
      ...failures,
    },
  });
  registry.registerPath({
    method: "get",
    path: "/conversations/{id}/participants",
    tags,
    security,
    summary: "Conversation participants",
    description: "Current members first, then people who left. Names come from Backend 1 (null if unavailable).",
    request: { params: idParams },
    responses: {
      200: ok("Participants", z.object({ status: z.literal("success"), data: z.array(participant) })),
      ...failures,
    },
  });
}
