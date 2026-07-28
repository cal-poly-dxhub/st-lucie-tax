import { useState } from "react";
import { Button, Card, Field, Input } from "@st-lucie/ui";
import { signIn, type AuthUser } from "../api";

interface Props {
  onLogin: (user: AuthUser) => void;
}

export function LoginPage({ onLogin }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = !submitting && email.trim().length > 0 && password.length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const user = await signIn(email.trim(), password);
      onLogin(user);
    } catch (err) {
      if (err instanceof Error) {
        if (err.message === "NOT_ADMIN") {
          setError("Your account does not have admin access.");
        } else if (err.message === "NEW_PASSWORD_REQUIRED") {
          setError("Password reset required. Please contact your administrator.");
        } else if (err.message.includes("Incorrect username or password")) {
          setError("Incorrect email or password.");
        } else {
          setError(err.message);
        }
      } else {
        setError("Sign-in failed.");
      }
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md p-7 animate-rise">
        <header>
          <h1 className="font-display text-xl font-bold text-civic-900">
            St. Lucie Tax Collector — Admin
          </h1>
          <p className="mt-1 text-sm text-civic-500">Sign in with your staff account</p>
        </header>

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
          <Field label="Email" htmlFor="login-email" required>
            <Input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              autoFocus
              placeholder="you@example.com"
              required
            />
          </Field>

          <Field label="Password" htmlFor="login-password" required>
            <Input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </Field>

          {error && (
            <div
              role="alert"
              className="rounded-xl border border-stop-200 bg-stop-50 px-4 py-3 text-sm font-medium text-stop-700"
            >
              {error}
            </div>
          )}

          <Button type="submit" variant="go" loading={submitting} disabled={!canSubmit}>
            {submitting ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        <p className="mt-6 border-t border-civic-100 pt-4 text-xs text-civic-400">
          Requires a Cognito account with admin group membership.
        </p>
      </Card>
    </div>
  );
}
