import {
  budgetStatus,
  buildTree,
  dashboard,
  dayOfWeek,
  formatDuration,
  parseIsoDate,
  rollup,
  type Totals,
} from "@stint/shared";
import { useMemo, useState } from "react";
import { useMe } from "../../app/session.tsx";
import { useSettings } from "../../tracking/hooks.ts";
import { Alert, Avatar, Progress } from "../../ui/misc.tsx";
import { BarList, StackedColumns } from "./Charts.tsx";
import { useReportData, useToday } from "./data.ts";
import { type FilterState, Filters, initialFilter, toReportFilter } from "./Filters.tsx";
import { MissingTimesheets } from "./MissingTimesheets.tsx";

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

  const budgets = useMemo(() => {
    if (!data) return [];
    const tree = buildTree(data.projects);
    const own = new Map<string, Totals>();
    for (const e of data.entries) {
      if (e.durationS === null || e.deletedAt) continue;
      const t = own.get(e.projectId) ?? { seconds: 0, entries: 0 };
      t.seconds += e.durationS;
      t.entries += 1;
      own.set(e.projectId, t);
    }
    const rolled = rollup(tree, own);
    return data.projects
      .filter((p) => !p.archivedAt && p.budgetMinutes)
      .map((p) => ({
        p,
        s: budgetStatus(p, rolled.get(p.id) ?? { seconds: 0 }),
        t: rolled.get(p.id),
      }))
      .sort((a, b) => (b.s.hoursRatio ?? 0) - (a.s.hoursRatio ?? 0))
      .slice(0, 8);
  }, [data]);

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
        <div className="stat">
          <div className="stat__label">Utilisation</div>
          <div className="stat__value">{pct(d.utilisation)}</div>
          <div className="stat__sub">hours ÷ {formatDuration(d.capacitySeconds)} h capacity</div>
        </div>
      </div>

      <div className="report-grid">
        <section className="card card__body stack">
          <h2>Hours per day</h2>
          {d.byDay.length > 62 ? (
            <p className="subtle">Choose a shorter period (up to two months) to see daily hours.</p>
          ) : (
            <StackedColumns
              label="Hours per day, client work and internal"
              series={[
                { name: "Client work", color: "var(--chart-client)" },
                { name: "Internal", color: "var(--chart-other)" },
              ]}
              data={d.byDay.map((x) => ({
                key: x.date,
                label: d.byDay.length <= 7 ? DAY[dayOfWeek(x.date)]! : String(parseIsoDate(x.date).d),
                values: [x.clientSeconds, x.internalSeconds],
                tooltipTitle: `${DAY[dayOfWeek(x.date)]} ${x.date}`,
              }))}
            />
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
                  <th className="num">Capacity</th>
                  <th className="num">Utilisation</th>
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
                    <td className="num mono">{formatDuration(p.capacitySeconds)}</td>
                    <td className="num">
                      {p.capacitySeconds ? pct(p.sum.seconds / p.capacitySeconds) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>

      <section className="card card__body stack">
        <h2>Budget burn</h2>
        {budgets.length === 0 && (
          <p className="subtle">No projects have an hours budget yet. Set one on the Projects page.</p>
        )}
        {budgets.map(({ p, s, t }) => {
          const ratio = s.hoursRatio ?? 0;
          return (
            <div key={p.id} className="stack stack--sm">
              <div className="row row--between">
                <span className="truncate" style={{ fontWeight: 500 }}>
                  <span className="dot" style={{ background: p.color, marginRight: 6 }} />
                  {p.code ? `${p.code} ` : ""}
                  {p.name}
                </span>
                <span className={`tnum tree-budget__label tree-budget__label--${s.level}`}>
                  {pct(ratio)} · {formatDuration(t?.seconds ?? 0)} / {Math.round((p.budgetMinutes ?? 0) / 60)}{" "}
                  h
                </span>
              </div>
              <Progress value={ratio} label={`${p.name} budget used`} />
              {s.level === "over" && <span className="field__error">Over budget</span>}
            </div>
          );
        })}
      </section>
      {me.user.role !== "member" && <MissingTimesheets />}
      {d.period.entries === 0 && <Alert tone="info">No hours have been logged in this period yet.</Alert>}
    </div>
  );
}
