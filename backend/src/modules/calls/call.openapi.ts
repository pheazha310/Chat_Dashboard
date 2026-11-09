import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { BEARER_AUTH } from "@shared/openapi/registry.js";
import { errors, jsonBody, ok, pagedOf, successOf } from "@shared/openapi/envelopes.js";
import { idParams } from "@shared/utils/ids.js";
import { callParams, listCallsQuery, startCallBody } from "./call.schema.js";
import type { CallDto } from "./call.types.js";

// `satisfies` keeps the schema in step with the TypeScript DTO: drift fails the build.
const call = z
  .object({
    id: z.string(),
    conversationId: z.string(),
    callType: z.enum(["AUDIO", "VIDEO"]),
    status: z.enum(["INITIATING", "RINGING", "ACTIVE", "ENDED", "DECLINED", "MISSED", "CANCELLED", "FAILED"]),
    initiatedBy: z.object({ type: z.enum(["AGENT", "CUSTOMER"]), id: z.string() }),
    participants: z.array(
      z.object({
        type: z.enum(["AGENT", "CUSTOMER"]),
        id: z.string(),
        joinedAt: z.string().nullable(),
        leftAt: z.string().nullable(),
      }),
    ),
    startedAt: z.string().nullable(),
    endedAt: z.string().nullable(),
    durationSeconds: z.number().int().nullable(),
    createdAt: z.string(),
    permissions: z.object({
      canAccept: z.boolean(),
      canDecline: z.boolean(),
      canCancel: z.boolean(),
      canEnd: z.boolean(),
    }),
  })
  .openapi("Call") satisfies z.ZodType<CallDto>;

const iceConfig = z
  .object({
    iceServers: z.array(
      z.object({ urls: z.array(z.string()), username: z.string().optional(), credential: z.string().optional() }),
    ),
    ringTimeoutSeconds: z.number().int(),
  })
  .openapi("CallConfig");

const security = [{ [BEARER_AUTH]: [] }];
const tags = ["Calls"];
const failures = { 400: errors[400], 401: errors[401], 403: errors[403], 404: errors[404] };

export function registerCallOpenApi(registry: OpenAPIRegistry) {
  registry.registerPath({
    method: "get",
    path: "/calls/config",
    tags,
    security,
    summary: "ICE servers for a call",
    description:
      "STUN and TURN servers for `RTCPeerConnection`. TURN credentials are short-lived and specific to the caller when a shared secret is configured. Responds with `Cache-Control: no-store`. Empty `iceServers` means none are configured (calls then only work on the same network).",
    responses: { 200: ok("Configuration", successOf(iceConfig)), 401: errors[401], 403: errors[403] },
  });
  registry.registerPath({
    method: "get",
    path: "/conversations/{id}/calls",
    tags,
    security,
    summary: "Call history of a conversation",
    description: "Newest first, any status. Needs access to the conversation.",
    request: { params: idParams, query: listCallsQuery },
    responses: { 200: ok("Calls", pagedOf(call)), ...failures },
  });
  registry.registerPath({
    method: "post",
    path: "/conversations/{id}/calls",
    tags,
    security,
    summary: "Call the customer",
    description:
      "Only the owner of a conversation that is not closed. The call starts `RINGING`; a conversation can have one call that is not over (409). Adds a `CALL` timeline entry and sends `call.incoming` to the customer's channel. After `call.accepted`, the caller sends the offer over the WebSocket (`call.offer`). Unanswered calls become `MISSED` after the ring timeout.",
    request: { params: idParams, body: jsonBody(startCallBody) },
    responses: { 201: ok("The call", successOf(call)), ...failures, 409: errors[409] },
  });
  registry.registerPath({
    method: "get",
    path: "/calls/{callId}",
    tags,
    security,
    summary: "One call",
    description: "Needs access to the call's conversation (otherwise 404).",
    request: { params: callParams },
    responses: { 200: ok("The call", successOf(call)), ...failures },
  });
  const action = (path: string, summary: string, description: string) =>
    registry.registerPath({
      method: "post",
      path: `/calls/{callId}/${path}`,
      tags,
      security,
      summary,
      description,
      request: { params: callParams },
      responses: { 200: ok("The call", successOf(call)), ...failures, 409: errors[409] },
    });
  action(
    "accept",
    "Answer a customer's call",
    "A ringing call a customer started: a supervisor, the owner, or any agent while nobody owns the conversation. The first to answer wins; the others get 409. The answering agent becomes a participant. Broadcast as `call.accepted`.",
  );
  action(
    "decline",
    "Decline a customer's call",
    "Same people as accept. The call becomes `DECLINED`. Broadcast as `call.declined`.",
  );
  action(
    "cancel",
    "Cancel a call I started",
    "Only the caller, and only while it rings. The call becomes `CANCELLED`. Broadcast as `call.ended` with reason `cancelled`.",
  );
  action(
    "end",
    "Hang up",
    "A participant, or a supervisor, on an answered call. Records the duration. Broadcast as `call.ended` with reason `ended`.",
  );
}
