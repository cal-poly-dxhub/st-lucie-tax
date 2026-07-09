/**
 * Admin SPA root. Two pages: overview and session-detail. Routing is a
 * custom mini-router using pushState + popstate.
 *
 * Auth: gates everything behind LoginPage until Cognito session is valid
 * and user is in the "admin" group.
 */

import { useCallback, useEffect, useState } from 'react';
import { getCurrentUser, signOut, type AuthUser } from './api';
import { LoginPage } from './components/LoginPage';
import { OverviewPage } from './pages/OverviewPage';
import { SessionDetailPage } from './pages/SessionDetailPage';

type Route =
  | { kind: 'overview' }
  | { kind: 'session'; sessionId: string };

function parseRoute(path: string): Route {
  const m = path.match(/^\/sessions\/([^/?#]+)/);
  if (m && m[1]) return { kind: 'session', sessionId: m[1] };
  return { kind: 'overview' };
}

function navigate(path: string) {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export default function App() {
  const [auth, setAuth] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));

  useEffect(() => {
    getCurrentUser().then((user) => {
      setAuth(user);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    const onPop = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const handleLogout = useCallback(async () => {
    await signOut();
    setAuth(null);
    navigate('/');
  }, []);

  if (loading) {
    return <div className="admin-loading">Loading…</div>;
  }

  if (auth === null) {
    return <LoginPage onLogin={setAuth} />;
  }

  return (
    <div className="admin-shell">
      <header className="admin-topbar">
        <div className="admin-brand" onClick={() => navigate('/')} role="button">
          St. Lucie Chatbot — Admin
        </div>
        <div className="admin-topbar-right">
          <span className="muted">{auth.email}</span>
          <button className="ghost-btn" onClick={handleLogout}>Log out</button>
        </div>
      </header>

      <main className="admin-main">
        {route.kind === 'overview' && (
          <OverviewPage onOpenSession={(id) => navigate(`/sessions/${id}`)} />
        )}
        {route.kind === 'session' && (
          <SessionDetailPage sessionId={route.sessionId} onBack={() => navigate('/')} />
        )}
      </main>
    </div>
  );
}
