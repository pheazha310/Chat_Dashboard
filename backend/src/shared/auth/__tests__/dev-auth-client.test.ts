import { describe, expect, it } from "vitest";
import { UnauthorizedError } from "@shared/errors/AppError.js";
import { DevAuthClient } from "../dev-auth-client.js";
import { uid } from "../../../__tests__/support/ids.js";

describe("DevAuthClient", () => {
  const client = new DevAuthClient();

  it("parses a valid token", async () => {
    await expect(client.verifyToken(`dev:${uid(42)}:AGENT`)).resolves.toEqual({ userId: uid(42), role: "AGENT" });
  });

  it.each(["", "dev:x:AGENT", `dev:${uid(1)}:ROOT`, `Bearer dev:${uid(1)}:AGENT`, "dev:1:agent"])(
    "rejects %j",
    async (token) => {
      await expect(client.verifyToken(token)).rejects.toBeInstanceOf(UnauthorizedError);
    },
  );
});
