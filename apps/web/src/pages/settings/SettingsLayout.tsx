import { NavLink, Outlet } from "react-router";

const LINKS = [
  { to: "/settings", label: "Organisation", end: true },
  { to: "/settings/health", label: "Health" },
  { to: "/settings/backups", label: "Backups" },
  { to: "/settings/remote", label: "Remote access" },
  { to: "/settings/import", label: "Import" },
  { to: "/settings/audit", label: "Audit log" },
];

export function SettingsLayout() {
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p>Company details, defaults and the health of your Stint Server.</p>
        </div>
      </div>
      <nav className="subnav" aria-label="Settings">
        {LINKS.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end}>
            {l.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
