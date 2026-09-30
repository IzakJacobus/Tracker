import { NavLink, Outlet } from "react-router";

export function ReportsLayout() {
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Reports</h1>
          <p>Timesheets, project hours and client summaries. Export any report as PDF, Excel or CSV.</p>
        </div>
      </div>
      <nav className="subnav" aria-label="Reports">
        <NavLink to="/reports" end>
          Overview
        </NavLink>
        <NavLink to="/reports/monthly">Monthly timesheet</NavLink>
        <NavLink to="/reports/project">Project timesheet</NavLink>
        <NavLink to="/reports/clients">Client summary</NavLink>
      </nav>
      <Outlet />
    </div>
  );
}
