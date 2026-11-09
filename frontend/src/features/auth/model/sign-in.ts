import { AuthError, signIn, signOut } from "@/shared/api/auth";

export type SignInResult = { ok: true } | { ok: false; error: string };

/**
 * Signs a staff member in with email and password. The server's message is shown as is: it already says the same thing
 * for an unknown email and a wrong password, and explains a lock or a disabled account.
 */
export async function submitSignIn(email: string, password: string): Promise<SignInResult> {
  const trimmed = email.trim();
  if (!trimmed || !password) return { ok: false, error: "Enter your email and password" };
  try {
    await signIn(trimmed, password);
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.status === 400) return { ok: false, error: "Enter a valid email address" };
      return { ok: false, error: error.message };
    }
    return { ok: false, error: "Sign-in failed; try again" };
  }
}

/** Signs out here, in every other tab, and on the server. */
export const submitSignOut = () => signOut();
