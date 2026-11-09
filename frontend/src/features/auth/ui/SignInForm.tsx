import { useState, type FormEvent } from "react";
import { submitSignIn } from "../model/sign-in";

/** Email and password sign-in for staff. On success the app shell takes over (it follows the auth store). */
export default function SignInForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    const result = await submitSignIn(email, password);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      setPassword("");
    }
  };

  return (
    <form className="sign-in-form" onSubmit={onSubmit} noValidate>
      <label>
        <span>Email</span>
        <input
          type="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          autoFocus
        />
      </label>
      <label>
        <span>Password</span>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </label>
      {error && (
        <p className="sign-in-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
