import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ signIn: vi.fn(), signOut: vi.fn() }));
vi.mock("@/shared/api/auth", async () => {
  const { AuthError } = await vi.importActual<typeof import("@/shared/api/auth/session")>("@/shared/api/auth/session");
  return { AuthError, signIn: auth.signIn, signOut: auth.signOut };
});

import { AuthError } from "@/shared/api/auth";
import { submitSignIn } from "./sign-in";

beforeEach(() => vi.clearAllMocks());

describe("submitSignIn", () => {
  it("trims the username and signs in", async () => {
    auth.signIn.mockResolvedValue({});
    await expect(submitSignIn("  ann ", "pw")).resolves.toEqual({ ok: true });
    expect(auth.signIn).toHaveBeenCalledWith("ann", "pw");
  });

  it("asks for both fields before calling the server", async () => {
    await expect(submitSignIn(" ", "pw")).resolves.toEqual({ ok: false, error: "Enter your username and password" });
    await expect(submitSignIn("ann", "")).resolves.toMatchObject({ ok: false });
    expect(auth.signIn).not.toHaveBeenCalled();
  });

  it("shows the server's reason, and a plain message for an invalid username", async () => {
    auth.signIn.mockRejectedValueOnce(new AuthError(429, "ACCOUNT_LOCKED", "Too many failed sign-in attempts"));
    await expect(submitSignIn("ann", "pw")).resolves.toEqual({
      ok: false,
      error: "Too many failed sign-in attempts",
    });
    auth.signIn.mockRejectedValueOnce(new AuthError(400, "BAD_REQUEST", "Validation failed"));
    await expect(submitSignIn("nope", "pw")).resolves.toEqual({
      ok: false,
      error: "Enter a valid username (3-32 letters, digits, . _ -)",
    });
  });
});
