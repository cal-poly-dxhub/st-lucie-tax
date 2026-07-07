import { useState } from 'react';
import { signIn, type AuthUser } from '../lib/auth';

interface Props {
  onLogin: (user: AuthUser) => void;
  notice?: string;
}

export function LoginPage({ onLogin, notice }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    !submitting && email.trim().length > 0 && password.length > 0;

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
        if (err.message === 'NEW_PASSWORD_REQUIRED') {
          setError('You need to set a new password. Contact your administrator.');
        } else if (err.message.includes('Incorrect') || err.message.includes('NotAuthorizedException')) {
          setError('Incorrect email or password.');
        } else {
          setError(err.message);
        }
      } else {
        setError('Sign-in failed.');
      }
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <h1>St. Lucie County Chatbot</h1>
          <p className="login-subtitle">Sign in to continue</p>
        </div>

        {notice && (
          <div className="login-notice" role="status">
            {notice}
          </div>
        )}

        <form onSubmit={handleSubmit} className="login-form">
          <label className="login-label">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoComplete="email"
              autoFocus
              placeholder="you@example.com"
              required
            />
          </label>

          <label className="login-label">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          {error && (
            <div className="login-error" role="alert">
              {error}
            </div>
          )}

          <button
            type="submit"
            className="login-submit"
            disabled={!canSubmit}
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="login-footer">
          Conversations are recorded for development purposes. Don't enter real
          Social Security numbers, full driver license numbers, or financial
          account details.
        </p>
      </div>
    </div>
  );
}
