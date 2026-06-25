import { useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth-context";

export function LoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signIn(email, password);
    } catch (err) {
      if (err instanceof Error) {
        if (err.message === "NEW_PASSWORD_REQUIRED") {
          setError("You must set a new password. Contact your administrator.");
        } else {
          setError(err.message);
        }
      } else {
        setError("Sign-in failed.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-civic-50 px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-5 rounded-2xl border border-civic-200 bg-white p-8 shadow-sm"
      >
        <div className="text-center">
          <h1 className="font-display text-xl font-bold text-civic-800">
            St. Lucie Tax Collector
          </h1>
          <p className="mt-1 text-sm text-civic-500">Staff sign-in</p>
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}

        <div>
          <label className="text-xs font-semibold text-civic-600">Email</label>
          <input
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-lg border border-civic-200 px-3 py-2 text-sm outline-none focus:border-civic-400 focus:ring-1 focus:ring-civic-400"
          />
        </div>

        <div>
          <label className="text-xs font-semibold text-civic-600">Password</label>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border border-civic-200 px-3 py-2 text-sm outline-none focus:border-civic-400 focus:ring-1 focus:ring-civic-400"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-civic-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-civic-700 disabled:opacity-60"
        >
          {loading ? "Signing in…" : "Sign In"}
        </button>
      </form>
    </div>
  );
}
