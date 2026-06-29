/**
 * Admin login screen — same shape as the chatbot app's tester login but
 * worded for staff/admin use. Master password is the same we hand out to
 * testers UNLESS we set ADMIN_PASSWORD separately at deploy.
 */

import { useState } from 'react';
import { login, saveAdminAuth, type AdminAuthState } from '../api';

interface Props {
  onLogin: (state: AdminAuthState) => void;
  notice?: string;
}

export function LoginPage({ onLogin, notice }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = !submitting && email.trim().length > 0 && password.length > 0;

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
      saveAdminAuth(result);
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
          <h1>St. Lucie Chatbot — Admin</h1>
          <p className="login-subtitle">Read-only dashboard sign-in</p>
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
            <span>Admin password</span>
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

          <button type="submit" className="login-submit" disabled={!canSubmit}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="login-footer">
          Beta admin dashboard. Sessions, transcripts, feedback — all read-only.
        </p>
      </div>
    </div>
  );
}
