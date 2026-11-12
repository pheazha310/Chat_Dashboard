import { SignInForm } from "@/features/auth";
import { accessContextLabel, currentAccessContext, useAuthStore } from "@/shared/api/auth";

/** Shown instead of the dashboard until a staff member signs in (backend mode only). */
export default function LoginPage() {
  const sessionExpired = useAuthStore((state) => state.sessionExpired);
  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <h1 id="login-title">Sign in</h1>
        <small data-testid="access-context">{accessContextLabel(currentAccessContext())}</small>
        {sessionExpired && (
          <p role="alert" data-testid="session-expired">
            Your session has expired. Sign in again with your chat username and password.
          </p>
        )}
        <p>Use the account your administrator created for you.</p>
        <SignInForm />
      </section>
    </main>
  );
}
