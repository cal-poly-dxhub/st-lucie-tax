/**
 * Beta-tester login screen. Shown when there's no auth state in
 * localStorage. Single shared master password (handed out manually);
 * email is captured per-tester so submitted feedback / transcripts can
 * be attributed.
 *
 * Email is also tied to the session at create-time on the server, so a
 * tester resuming a session URL needs to sign in with the matching email
 * (or click "New session" to start fresh).
 */

import { useState } from 'react';
import { login, saveBetaAuth, type BetaAuthState } from '../api';

interface Props {
  onLogin: (state: BetaAuthState) => void;
  /**
   * Optional inline message shown above the form. Set when the parent
   * forces a re-login (e.g. session-belongs-to-another-tester rejection
   * from rehydrate). Shown in a yellow notice box.
   */
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
      const result = await login(email.trim(), password);
      if ('error' in result) {
        setError(result.error);
        setSubmitting(false);
        return;
      }
      saveBetaAuth(result);
      onLogin(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <h1>St. Lucie County Chatbot</h1>
          <p className="login-subtitle">Beta tester sign-in</p>
        </div>

        {notice && (
          <div className="login-notice" role="status">
            {notice}
          </div>
        )}

        <form onSubmit={handleSubmit} className="login-form">
          <label className="login-label">
            <span>Your email</span>
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
            <span>Beta password</span>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="Provided by Mason"
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
        <p className="login-footer login-footer--contact">
          Having trouble? Contact{' '}
          <a href="mailto:maintainer@example.com">maintainer@example.com</a>
        </p>
      </div>
    </div>
  );
}
