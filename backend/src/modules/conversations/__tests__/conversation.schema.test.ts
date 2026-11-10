import { describe, expect, it } from "vitest";
import { joinBody } from "@modules/customer-channel/customer-channel.schema.js";
import { uid } from "../../../__tests__/support/ids.js";
import { createBody } from "../conversation.schema.js";

describe("applicationId (the LOS loan application number)", () => {
  const bodies = [
    ["staff create", (applicationId: unknown) => createBody.safeParse({ customerId: uid(1), applicationId })],
    ["customer join", (applicationId: unknown) => joinBody.safeParse({ applicationId })],
  ] as const;

  it.each(bodies)("%s accepts a positive integer", (_, parse) => {
    const result = parse(12345);
    expect(result.success && result.data.applicationId).toBe(12345);
  });

  it.each(bodies)("%s rejects a UUID, zero, a fraction and a value too big for INT", (_, parse) => {
    for (const bad of [uid(7), 0, -1, 1.5, 2147483648]) expect(parse(bad).success).toBe(false);
  });
});
