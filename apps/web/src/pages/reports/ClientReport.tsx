import { buildLines, clientSummary, formatDuration } from "@stint/shared";
import { clientSummaryDoc } from "@stint/shared/export";
import { useMemo, useState } from "react";
import { useMe } from "../../app/session.tsx";
import { formatMoney } from "../../lib/format.ts";
import { useSettings } from "../../tracking/hooks.ts";
import { Alert } from "../../ui/misc.tsx";
import { useReportData, useToday } from "./data.ts";
import { ExportButtons, useDocOptions } from "./exporting.tsx";
import { type FilterState, Filters, initialFilter, toReportFilter } from "./Filters.tsx";

/** Billable hours and amounts per project, per client — the basis for invoices. */
export function ClientReportPage() {
  const me = useMe();
  const settings = useSettings();
  const today = useToday();
  const data = useReportData();
  const [f, setF] = useState<FilterState>(() => initialFilter(today, settings.weekStart, "last-month"));
  const opts = useDocOptions(data?.tags ?? []);
  const money = me.permissions.seeRates;
  const s = useMemo(() => (data ? clientSummary(data, toReportFilter(f)) : null), [data, f]);
  const lines = useMemo(
    () =>
      data
        ? buildLines(data, { ...toReportFilter(f), billable: "billable" }).filter(
            (l) => !l.client?.isInternal,
          )
        : [],
    [data, f],
  );
  if (!data || !s) return null;
  return (
    <div className="stack stack--lg">
      <div className="row row--between row--wrap">
        <p className="muted">
          Billable time only; internal work is left out. Hours use the rounding rule from Settings.
        </p>
        <ExportButtons
          fileBase={`Client summary ${f.from} to ${f.to}`}
          lines={lines}
          tags={data.tags}
          buildDoc={() => clientSummaryDoc(s, { ...opts, from: f.from, to: f.to })}
        />
      </div>
      <Filters value={f} onChange={setF} data={data} show={{ billable: false, tag: true }} />
      <div className="stat-row">
        <div className="stat">
          <div className="stat__label">Billable hours</div>
          <div className="stat__value mono">{formatDuration(s.total.billableBilledSeconds)}</div>
          <div className="stat__sub">exact: {formatDuration(s.total.billableSeconds)}</div>
        </div>
        {money && (
          <div className="stat">
            <div className="stat__label">Amount (excl. VAT)</div>
            <div className="stat__value">{formatMoney(s.total.amount, settings.currency)}</div>
          </div>
        )}
        <div className="stat">
          <div className="stat__label">Clients</div>
          <div className="stat__value">{s.clients.length}</div>
        </div>
      </div>
      {s.clients.length === 0 && <Alert tone="info">No billable time in this period.</Alert>}
      {s.clients.map((c) => (
        <section key={c.clientId} className="card" style={{ overflow: "auto" }}>
          <div className="card__header">
            <h2>{c.client?.name ?? "Unknown client"}</h2>
            <span className="mono">{formatDuration(c.sum.billableBilledSeconds)}</span>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Project</th>
                <th className="num">Billable hours</th>
                {money && <th className="num">Amount</th>}
              </tr>
            </thead>
            <tbody>
              {c.projects.map((p) => (
                <tr key={p.projectId}>
                  <td>{p.path}</td>
                  <td className="num mono">{formatDuration(p.sum.billableBilledSeconds)}</td>
                  {money && <td className="num tnum">{formatMoney(p.sum.amount, settings.currency)}</td>}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td className="num mono">{formatDuration(c.sum.billableBilledSeconds)}</td>
                {money && <td className="num tnum">{formatMoney(c.sum.amount, settings.currency)}</td>}
              </tr>
            </tfoot>
          </table>
        </section>
      ))}
    </div>
  );
}
