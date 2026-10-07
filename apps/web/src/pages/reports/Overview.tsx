import { dashboard, formatDuration } from "@stint/shared";
import { useMemo, useState } from "react";
import { useMe } from "../../app/session.tsx";
import { useSettings } from "../../tracking/hooks.ts";
import { Alert, Avatar } from "../../ui/misc.tsx";
import { BarList } from "./Charts.tsx";
import { useReportData, useToday } from "./data.ts";
import { type FilterState, Filters, initialFilter, toReportFilter } from "./Filters.tsx";
import { MissingTimesheets } from "./MissingTimesheets.tsx";

export function Overview() {
  const me = useMe();
  const settings = useSettings();
  const today = useToday();
  const data = useReportData();
  const [f, setF] = useState<FilterState>(() => initialFilter(today, settings.weekStart, "this-month"));
  const people = useMemo(
    () =>
      data ? (me.user.role === "member" ? data.users.filter((u) => u.id === me.user.id) : data.users) : [],
    [data, me],
  );
  const filter = useMemo(() => toReportFilter(f), [f]);
  const d = useMemo(
    () =>
      data ? dashboard(data, filter, f.userId ? people.filter((p) => p.id === f.userId) : people) : null,
    [data, filter, people, f.userId],
  );

  if (!data || !d) return null;
  const pct = (x: number) => `${Math.round(x * 100)}%`;

  return (
    <div className="stack stack--lg">
      <Filters
        value={f}
        onChange={setF}
        data={data}
        show={{ tag: true, project: true, client: true, user: true }}
      />
      <div className="stat-row">
        <div className="stat">
          <div className="stat__label">Hours logged</div>
          <div className="stat__value mono">{formatDuration(d.period.seconds)}</div>
          <div className="stat__sub">{d.period.entries} entries</div>
        </div>
        <div className="stat">
          <div className="stat__label">Client work</div>
          <div className="stat__value">{pct(d.clientShare)}</div>
          <div className="stat__sub">of hours logged (the rest is Internal)</div>
        </div>
      </div>

      <div className="report-grid">
        <section className="card card__body stack">
          <h2>Hours per item</h2>
          <BarList
            items={d.byItem.slice(0, 15).map((t) => ({
              key: t.projectId,
              label: t.path,
              sub: t.client?.name,
              value: t.sum.seconds,
            }))}
            format={(v) => formatDuration(v)}
            emptyText="No hours logged in this period."
          />
          {d.byItem.length > 15 && (
            <p className="subtle">
              The {d.byItem.length - 15} items with the fewest hours aren't shown. Use the Project timesheet
              to see all of them.
            </p>
          )}
        </section>
        <section className="card card__body stack">
          <h2>Top projects</h2>
          <BarList
            items={d.topProjects.map((t) => ({
              key: t.projectId,
              label: t.path,
              sub: t.client?.name,
              value: t.sum.seconds,
            }))}
            format={(v) => formatDuration(v)}
            emptyText="No hours logged in this period."
          />
        </section>
      </div>

      <div className="report-grid">
        <section className="card card__body stack">
          <h2>Hours per client</h2>
          <BarList
            items={d.byClient.map((c) => ({
              key: c.clientId,
              label: c.client?.name ?? "Unknown client",
              value: c.sum.seconds,
            }))}
            format={(v) => formatDuration(v)}
            emptyText="No hours logged in this period."
          />
        </section>
        {me.user.role !== "member" && (
          <section className="card" style={{ overflow: "auto" }}>
            <div className="card__header">
              <h2>People</h2>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th className="num">Hours</th>
                </tr>
              </thead>
              <tbody>
                {d.byPerson.map((p) => (
                  <tr key={p.userId}>
                    <td>
                      <div className="row">
                        {p.user && <Avatar name={p.user.name} color={p.user.color} />}
                        {p.user?.name}
                      </div>
                    </td>
                    <td className="num mono">{formatDuration(p.sum.seconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>

      {me.user.role !== "member" && <MissingTimesheets />}
      {d.period.entries === 0 && <Alert tone="info">No hours have been logged in this period yet.</Alert>}
    </div>
  );
}
