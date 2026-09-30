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
import { formatMoney } from "../../lib/format.ts";
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
  const seesMoney = me.permissions.seeRates;
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
      const t = own.get(e.projectId) ?? { seconds: 0, billableSeconds: 0, amount: 0, entries: 0 };
      t.seconds += e.durationS;
      if (e.billable) t.amount += Math.round((e.durationS * (e.rateSnapshot ?? 0)) / 3600);
      own.set(e.projectId, t);
    }
    const rolled = rollup(tree, own);
    return data.projects
      .filter((p) => !p.archivedAt && (p.budgetMinutes || p.budgetAmount))
      .map((p) => ({
        p,
        s: budgetStatus(p, rolled.get(p.id) ?? { seconds: 0, amount: 0 }),
        t: rolled.get(p.id),
      }))
      .sort(
        (a, b) =>
          Math.max(b.s.hoursRatio ?? 0, b.s.amountRatio ?? 0) -
          Math.max(a.s.hoursRatio ?? 0, a.s.amountRatio ?? 0),
      )
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
        show={{ tag: true, billable: false, project: true, client: true, user: true }}
      />
      <div className="stat-row">
        <div className="stat">
          <div className="stat__label">Hours tracked</div>
          <div className="stat__value mono">{formatDuration(d.period.seconds)}</div>
          <div className="stat__sub">{d.period.entries} entries</div>
        </div>
        <div className="stat">
          <div className="stat__label">Billable hours</div>
          <div className="stat__value mono">{formatDuration(d.period.billableSeconds)}</div>
          <div className="stat__sub">{pct(d.billableShare)} of hours tracked</div>
        </div>
        <div className="stat">
          <div className="stat__label">Billable utilisation</div>
          <div className="stat__value">{pct(d.utilisation)}</div>
          <div className="stat__sub">billable ÷ {formatDuration(d.capacitySeconds)} h capacity</div>
        </div>
        {seesMoney && (
          <div className="stat">
            <div className="stat__label">Billable amount</div>
            <div className="stat__value">{formatMoney(d.period.amount, settings.currency)}</div>
            <div className="stat__sub">at the rates saved on each entry</div>
          </div>
        )}
      </div>

      <div className="report-grid">
        <section className="card card__body stack">
          <h2>Hours per day</h2>
          {d.byDay.length > 62 ? (
            <p className="subtle">Choose a shorter period (up to two months) to see daily hours.</p>
          ) : (
            <StackedColumns
              label="Hours per day, billable and non-billable"
              series={[
                { name: "Billable", color: "var(--chart-billable)" },
                { name: "Non-billable", color: "var(--chart-other)" },
              ]}
              data={d.byDay.map((x) => ({
                key: x.date,
                label: d.byDay.length <= 7 ? DAY[dayOfWeek(x.date)]! : String(parseIsoDate(x.date).d),
                values: [x.billableSeconds, x.otherSeconds],
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
            emptyText="No time tracked in this period."
          />
        </section>
      </div>

      <div className="report-grid">
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
                  <th className="num">Billable</th>
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
                    <td className="num mono">{formatDuration(p.sum.billableSeconds)}</td>
                    <td className="num mono">{formatDuration(p.capacitySeconds)}</td>
                    <td className="num">
                      {p.capacitySeconds ? pct(p.sum.billableSeconds / p.capacitySeconds) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
        <section className="card card__body stack">
          <h2>Budget burn</h2>
          {budgets.length === 0 && (
            <p className="subtle">No projects have a budget yet. Set one on the Projects page.</p>
          )}
          {budgets.map(({ p, s, t }) => {
            const ratio = Math.max(s.hoursRatio ?? 0, s.amountRatio ?? 0);
            return (
              <div key={p.id} className="stack stack--sm">
                <div className="row row--between">
                  <span className="truncate" style={{ fontWeight: 500 }}>
                    <span className="dot" style={{ background: p.color, marginRight: 6 }} />
                    {p.name}
                  </span>
                  <span className={`tnum tree-budget__label tree-budget__label--${s.level}`}>
                    {pct(ratio)}
                    {p.budgetMinutes
                      ? ` · ${formatDuration(t?.seconds ?? 0)} / ${Math.round(p.budgetMinutes / 60)} h`
                      : ""}
                  </span>
                </div>
                <Progress value={ratio} label={`${p.name} budget used`} />
                {s.level === "over" && <span className="field__error">Over budget</span>}
              </div>
            );
          })}
        </section>
      </div>
      {me.user.role !== "member" && <MissingTimesheets />}
      {d.period.entries === 0 && <Alert tone="info">No time has been tracked in this period yet.</Alert>}
    </div>
  );
}
