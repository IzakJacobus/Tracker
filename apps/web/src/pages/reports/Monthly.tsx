import { dayOfWeek, formatDuration, monthlyTimesheet, monthName, parseIsoDate } from "@stint/shared";
import { monthlyTimesheetDoc } from "@stint/shared/export";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { useMe } from "../../app/session.tsx";
import { useData } from "../../data/DataProvider.tsx";
import { fmtDate } from "../../lib/format.ts";
import { useSettings } from "../../tracking/hooks.ts";
import { Field, Input, Select } from "../../ui/Field.tsx";
import { Badge } from "../../ui/misc.tsx";
import { useReportData, useToday } from "./data.ts";
import { ExportButtons, useDocOptions } from "./exporting.tsx";

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const STATUS: Record<string, string> = {
  draft: "Not submitted",
  submitted: "Submitted — waiting for approval",
  approved: "Approved",
  rejected: "Sent back for changes",
};

/** Every hour one person worked in a month — the document staff hand in. */
export function MonthlyReport() {
  const me = useMe();
  const settings = useSettings();
  const today = useToday();
  const { db } = useData();
  const data = useReportData();
  const [params] = useSearchParams();
  const [userId, setUserId] = useState(params.get("user") ?? me.user.id);
  const [month, setMonth] = useState(
    /^\d{4}-\d{2}$/.test(params.get("month") ?? "") ? params.get("month")! : today.slice(0, 7),
  );
  const opts = useDocOptions(data?.tags ?? []);
  const m = useMemo(() => (data ? monthlyTimesheet(data, userId, month) : null), [data, userId, month]);
  const sheet = useLiveQuery(
    () =>
      db.timesheets
        .where("userId")
        .equals(userId)
        .filter((t) => t.periodStart <= `${month}-01` && t.periodEnd >= `${month}-01`)
        .first(),
    [db, userId, month],
  );
  if (!data || !m) return null;
  const people = data.users
    .filter((u) => u.active || u.id === userId)
    .sort((a, b) => a.name.localeCompare(b.name));
  const { y, m: mo } = parseIsoDate(`${month}-01`);
  const status = sheet ? STATUS[sheet.status] : STATUS.draft;
  const name = m.user?.name ?? me.user.name;

  return (
    <div className="stack stack--lg">
      <div className="filters">
        {me.user.role !== "member" && people.length > 1 && (
          <Field label="Person">
            <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
              {people.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Month">
          <Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        </Field>
        <div className="grow" />
        <ExportButtons
          fileBase={`Timesheet ${name} ${month}`}
          lines={m.lines}
          tags={data.tags}
          buildDoc={() => monthlyTimesheetDoc(m, { ...opts, status })}
        />
      </div>

      <div className="row row--between row--wrap">
        <h2>
          {name} · {monthName(mo)} {y}
        </h2>
        <Badge
          tone={
            sheet?.status === "approved"
              ? "primary"
              : sheet?.status === "rejected"
                ? "danger"
                : sheet?.status === "submitted"
                  ? "info"
                  : undefined
          }
        >
          {status}
        </Badge>
      </div>

      <div className="stat-row">
        <div className="stat">
          <div className="stat__label">Hours worked</div>
          <div className="stat__value mono">{formatDuration(m.total.seconds)}</div>
          <div className="stat__sub">expected {formatDuration(m.expectedSeconds)}</div>
        </div>
        <div className="stat">
          <div className="stat__label">Client work</div>
          <div className="stat__value mono">{formatDuration(m.total.seconds - m.internalSeconds)}</div>
        </div>
        <div className="stat">
          <div className="stat__label">Internal</div>
          <div className="stat__value mono">{formatDuration(m.internalSeconds)}</div>
          <div className="stat__sub">admin, training, leave…</div>
        </div>
      </div>

      <section className="card" style={{ overflow: "auto" }}>
        <div className="card__header">
          <h2>Summary by project</h2>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Client</th>
              <th>Worked on</th>
              <th className="num">Hours</th>
            </tr>
          </thead>
          <tbody>
            {m.byProject.length === 0 && (
              <tr>
                <td colSpan={3} className="subtle">
                  No hours logged this month.
                </td>
              </tr>
            )}
            {m.byProject.map((p) => (
              <tr key={p.projectId}>
                <td>
                  {p.client?.name}
                  {p.internal && (
                    <>
                      {" "}
                      <Badge tone="info">Internal</Badge>
                    </>
                  )}
                </td>
                <td>{p.path}</td>
                <td className="num mono">{formatDuration(p.sum.seconds)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>Total</td>
              <td className="num mono">{formatDuration(m.total.seconds)}</td>
            </tr>
          </tfoot>
        </table>
      </section>

      <section className="card" style={{ overflow: "auto" }}>
        <div className="card__header">
          <h2>Daily totals</h2>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Day</th>
              <th className="num">Hours</th>
              <th className="num">Expected</th>
            </tr>
          </thead>
          <tbody>
            {m.days.map((d) => {
              const short = d.working && d.sum.seconds < d.expectedSeconds && d.date < today;
              return (
                <tr key={d.date} style={{ background: d.working ? undefined : "var(--bg-subtle)" }}>
                  <td className="mono">{fmtDate(d.date, settings)}</td>
                  <td>{DAY[dayOfWeek(d.date)]}</td>
                  <td
                    className="num mono"
                    style={{ color: short ? "var(--warning)" : undefined, fontWeight: 500 }}
                  >
                    {d.sum.seconds ? formatDuration(d.sum.seconds) : ""}
                  </td>
                  <td className="num mono subtle">
                    {d.expectedSeconds ? formatDuration(d.expectedSeconds) : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>Total</td>
              <td className="num mono">{formatDuration(m.total.seconds)}</td>
              <td className="num mono">{formatDuration(m.expectedSeconds)}</td>
            </tr>
          </tfoot>
        </table>
      </section>
    </div>
  );
}
