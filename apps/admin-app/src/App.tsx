/**
 * Admin SPA root.
 *
 * Three top-level surfaces: Sessions (chatbot session review, served by the
 * Chatbot stack's AdminFn), Configuration (office-operations config, served by
 * the BackOffice stack's AppointmentFn under /api/ops-admin), and Performance.
 *
 * Auth gates everything behind LoginPage until the Cognito session is valid and
 * the user is in the "admin" group.
 */

import { useCallback, useEffect, useState } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  NavLink,
  Navigate,
  Outlet,
  useNavigate,
  useParams,
} from "react-router-dom";
import { ToastProvider } from "@st-lucie/ui";
import { getCurrentUser, signOut, type AuthUser } from "./api";
import { LoginPage } from "./components/LoginPage";
import { OverviewPage } from "./pages/OverviewPage";
import { SessionDetailPage } from "./pages/SessionDetailPage";
import { ConfigLayout } from "./pages/config/ConfigLayout";
import { GlobalConfigPage } from "./pages/config/GlobalConfigPage";
import { OfficesPage } from "./pages/config/OfficesPage";
import { TransactionsPage } from "./pages/config/TransactionsPage";
import { ClerksPage } from "./pages/config/ClerksPage";
import { HotbuttonsPage } from "./pages/config/HotbuttonsPage";
import { PrescreenPage } from "./pages/config/PrescreenPage";
import { DocumentsPage } from "./pages/config/DocumentsPage";
import { PerformancePage } from "./pages/PerformancePage";
import { officeOpsUrl, chatbotUrl } from "./app-links";

const navLink =
  "rounded-md px-3 py-2 text-sm font-semibold text-civic-200 transition-colors hover:bg-white/10 hover:text-white";
const navActive = "!bg-civic-500/80 !text-white";

function TopBar({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  return (
    <nav className="sticky top-0 z-50 border-b border-civic-800/40 bg-civic-950/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-1 px-4 py-2">
        <span className="mr-4 font-display text-base font-bold text-white">
          St. Lucie Tax Collector — Admin
        </span>
        <NavLink
          to="/sessions"
          className={({ isActive }) => `${navLink} ${isActive ? navActive : ""}`}
        >
          Sessions
        </NavLink>
        <NavLink
          to="/config"
          className={({ isActive }) => `${navLink} ${isActive ? navActive : ""}`}
        >
          Configuration
        </NavLink>
        <NavLink
          to="/performance"
          className={({ isActive }) => `${navLink} ${isActive ? navActive : ""}`}
        >
          Performance
        </NavLink>

        {/* Other SPAs: full page loads, so plain anchors rather than NavLink. */}
        <span className="mx-1 h-5 w-px bg-civic-800/60" aria-hidden />
        <a href={officeOpsUrl} className={navLink}>
          Office Ops
        </a>
        <a href={chatbotUrl} className={navLink}>
          Chatbot
        </a>

        <span className="ml-auto flex items-center gap-3">
          <span className="text-xs text-civic-300">{user.email}</span>
          <button
            onClick={onLogout}
            className="rounded-md px-3 py-2 text-sm font-medium text-civic-300 hover:text-white"
          >
            Sign Out
          </button>
        </span>
      </div>
    </nav>
  );
}

/** Bridges the session table's callback API to the router. */
function SessionsRoute() {
  const navigate = useNavigate();
  return <OverviewPage onOpenSession={(id) => navigate(`/sessions/${id}`)} />;
}

function SessionDetailRoute() {
  const navigate = useNavigate();
  const { sessionId } = useParams<{ sessionId: string }>();
  return <SessionDetailPage sessionId={sessionId ?? ""} onBack={() => navigate("/sessions")} />;
}

function Shell({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  return (
    <div className="min-h-screen">
      <TopBar user={user} onLogout={onLogout} />
      <main className="mx-auto w-full max-w-7xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}

export default function App() {
  const [auth, setAuth] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getCurrentUser().then((user) => {
      setAuth(user);
      setLoading(false);
    });
  }, []);

  const handleLogout = useCallback(async () => {
    await signOut();
    setAuth(null);
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-civic-400">Loading…</div>
    );
  }

  if (auth === null) {
    return <LoginPage onLogin={setAuth} />;
  }

  return (
    <BrowserRouter basename="/admin">
      <ToastProvider>
        <Routes>
          <Route element={<Shell user={auth} onLogout={handleLogout} />}>
            <Route index element={<Navigate to="/sessions" replace />} />
            <Route path="/sessions" element={<SessionsRoute />} />
            <Route path="/sessions/:sessionId" element={<SessionDetailRoute />} />

            <Route path="/config" element={<ConfigLayout />}>
              <Route index element={<Navigate to="/config/global" replace />} />
              <Route path="global" element={<GlobalConfigPage />} />
              <Route path="offices" element={<OfficesPage />} />
              <Route path="transactions" element={<TransactionsPage />} />
              <Route path="clerks" element={<ClerksPage />} />
              <Route path="hotbuttons" element={<HotbuttonsPage />} />
              <Route path="prescreen" element={<PrescreenPage />} />
              <Route path="documents" element={<DocumentsPage />} />
            </Route>

            <Route path="/performance" element={<PerformancePage />} />
            <Route path="*" element={<Navigate to="/sessions" replace />} />
          </Route>
        </Routes>
      </ToastProvider>
    </BrowserRouter>
  );
}
