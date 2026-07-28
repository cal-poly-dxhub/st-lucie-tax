import { NavLink, Outlet } from "react-router-dom";

const TABS = [
  { to: "global", label: "Global" },
  { to: "offices", label: "Offices" },
  { to: "transactions", label: "Transactions" },
  { to: "clerks", label: "Clerks" },
  { to: "hotbuttons", label: "Hotbuttons" },
  { to: "prescreen", label: "Pre-Screen" },
  { to: "documents", label: "Documents" },
];

export function ConfigLayout() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-2xl font-bold text-civic-900">Configuration</h1>
        <p className="mt-1 text-sm text-civic-500">
          Office-operations settings. Changes take effect immediately.
        </p>
      </div>

      <nav className="flex flex-wrap gap-1 border-b border-civic-100">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) =>
              [
                "-mb-px border-b-2 px-3 py-2 text-sm font-semibold transition-colors",
                isActive
                  ? "border-civic-500 text-civic-700"
                  : "border-transparent text-civic-400 hover:border-civic-200 hover:text-civic-600",
              ].join(" ")
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>

      <Outlet />
    </div>
  );
}
