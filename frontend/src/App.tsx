import { BrowserRouter, Routes, Route, NavLink, Navigate, Outlet } from "react-router-dom";
import { ToastProvider } from "@st-lucie/ui";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { chatbotUrl, adminUrl } from "@/lib/app-links";
import { LoginPage } from "@/pages/LoginPage";
import { CheckInDesk } from "@/pages/CheckInDesk";
import { WalkIn } from "@/pages/WalkIn";
import { QueuePage } from "@/pages/QueuePage";
import { SchedulePage } from "@/pages/SchedulePage";
import { ServiceClerk } from "@/pages/ServiceClerk";
import { LobbyDisplay } from "@/pages/LobbyDisplay";
import { PrescreenPage } from "@/pages/PrescreenPage";
import { ConfirmationPage } from "@/pages/ConfirmationPage";

function NavBar() {
  const { user, signOut } = useAuth();
  const link =
    "rounded-md px-3 py-2 text-sm font-semibold text-civic-200 transition-colors hover:bg-white/10 hover:text-white";
  const active = "!bg-civic-500/80 !text-white";

  return (
    <nav className="sticky top-0 z-50 border-b border-civic-800/40 bg-civic-950/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-1 px-4 py-2">
        <span className="mr-4 font-display text-base font-bold text-white">
          St. Lucie Tax Collector
        </span>
        <NavLink
          to="/confirmation"
          className={({ isActive }) => `${link} ${isActive ? active : ""}`}
        >
          Book Appt
        </NavLink>
        <NavLink to="/check-in" className={({ isActive }) => `${link} ${isActive ? active : ""}`}>
          Check-In
        </NavLink>
        <NavLink to="/walk-in" className={({ isActive }) => `${link} ${isActive ? active : ""}`}>
          Walk-In
        </NavLink>
        <NavLink to="/queue" className={({ isActive }) => `${link} ${isActive ? active : ""}`}>
          Queue
        </NavLink>
        <NavLink to="/schedule" className={({ isActive }) => `${link} ${isActive ? active : ""}`}>
          Schedule
        </NavLink>
        <NavLink to="/service" className={({ isActive }) => `${link} ${isActive ? active : ""}`}>
          Service Clerk
        </NavLink>
        <NavLink to="/lobby" className={({ isActive }) => `${link} ${isActive ? active : ""}`}>
          Lobby Display
        </NavLink>

        {/* Other SPAs: full page loads, so plain anchors rather than NavLink. */}
        <span className="mx-1 h-5 w-px bg-civic-800/60" aria-hidden />
        <a href={chatbotUrl} className={link}>
          Chatbot
        </a>
        {user?.groups.includes("admin") && (
          <a href={adminUrl} className={link}>
            Admin
          </a>
        )}

        {user && (
          <button
            onClick={signOut}
            className="ml-auto rounded-md px-3 py-2 text-sm font-medium text-civic-300 hover:text-white"
          >
            Sign Out
          </button>
        )}
      </div>
    </nav>
  );
}

function RequireAuth() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-civic-400">Loading...</div>
    );
  }
  if (!user) return <LoginPage />;
  return <Outlet />;
}

function Layout() {
  return (
    <div className="min-h-screen">
      <NavBar />
      <Outlet />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            {/* Public pages — no auth required */}
            <Route path="/lobby" element={<LobbyDisplay />} />
            <Route path="/prescreen/:code" element={<PrescreenPage />} />

            {/* Staff pages — require Cognito auth */}
            <Route element={<RequireAuth />}>
              <Route element={<Layout />}>
                <Route index element={<Navigate to="/check-in" replace />} />
                <Route path="/confirmation" element={<ConfirmationPage />} />
                <Route path="/check-in" element={<CheckInDesk />} />
                <Route path="/walk-in" element={<WalkIn />} />
                <Route path="/queue" element={<QueuePage />} />
                <Route path="/schedule" element={<SchedulePage />} />
                <Route path="/service" element={<ServiceClerk />} />
              </Route>
            </Route>
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
