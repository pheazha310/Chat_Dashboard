import { SignInForm } from "@/features/auth";

/** Shown instead of the dashboard until a staff member signs in (backend mode only). */
export default function LoginPage() {
  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <h1 id="login-title">Sign in</h1>
        <p>Use the account your administrator created for you.</p>
        <SignInForm />
      </section>
    </main>
  );
}
