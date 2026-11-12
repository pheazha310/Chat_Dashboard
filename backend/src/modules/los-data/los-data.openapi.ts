import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { BEARER_AUTH } from "@shared/openapi/registry.js";
import { errors, ok, successOf } from "@shared/openapi/envelopes.js";
import { idParams } from "@shared/utils/ids.js";
import type { LoanApplicationDto } from "./los-data.types.js";

const nullableString = z.string().nullable();
const nullableInt = z.number().int().nullable();

// `satisfies` keeps the schema in step with the TypeScript DTO: drift fails the build.
const loanApplication = z
  .object({
    applicationId: z.number().int(),
    status: z.string(),
    ticketNumber: nullableString,
    appliedDate: nullableString,
    loanPurpose: nullableString,
    requestedLoanSize: nullableInt,
    requestedLoanTerm: nullableInt,
    fetchedAt: z.string(),
  })
  .openapi("LoanApplication") satisfies z.ZodType<LoanApplicationDto>;

export function registerLoanApplicationOpenApi(registry: OpenAPIRegistry) {
  registry.registerPath({
    method: "get",
    path: "/conversations/{id}/application",
    tags: ["Customer information"],
    security: [{ [BEARER_AUTH]: [] }],
    summary: "Loan application behind a conversation",
    description:
      "Six fields of the customer's LOS application, read from LOS with the customer's own token when they last signed in with LOS (so `fetchedAt` says how fresh it is). `data` is null when the conversation has no application, it has not been read yet, or it belongs to another customer. `status` is LOS's own open string; `appliedDate` is as LOS sends it (Cambodia local time labelled Z, not converted); amount is USD and tenor is days.",
    request: { params: idParams },
    responses: {
      200: ok("The application, or null", successOf(loanApplication.nullable())),
      401: errors[401],
      404: errors[404],
    },
  });
}
