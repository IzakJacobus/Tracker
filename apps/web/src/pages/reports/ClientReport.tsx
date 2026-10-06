import { buildLines, clientSummary, formatDuration } from "@stint/shared";
import { clientSummaryDoc } from "@stint/shared/export";
import { useMemo, useState } from "react";
import { useSettings } from "../../tracking/hooks.ts";
import { Alert } from "../../ui/misc.tsx";
import { useReportData, useToday } from "./data.ts";
import { ExportButtons, useDocOptions } from "./exporting.tsx";
import { type FilterState, Filters, initialFilter, toReportFilter } from "./Filters.tsx";

/** Hours per client, and per project and item within it. */
export function ClientReportPage() {
  const settings = useSettings();
  const today = useToday();
  const data = useReportData();
  const [f, setF] = useState<FilterState>(() => initialFilter(today, settings.weekStart, "last-month"));
  const opts = useDocOptions(data?.tags ?? []);
  const s = useMemo(() => (data ? clientSummary(data, toReportFilter(f)) : null), [data, f]);
  const lines = useMemo(() => (data ? buildLines(data, toReportFilter(f)) : []), [data, f]);
  if (!data || !s) return null;
  return (
    <div className="stack stack--lg">
      <div className="row row--between row--wrap">
        <p className="muted">Hours per client and item. The firm's own (Internal) work is listed last.</p>
        <ExportButtons
          fileBase={`Client summary ${f.from} to ${f.to}`}
          lines={lines}
          tags={data.tags}
          buildDoc={() => clientSummaryDoc(s, { ...opts, from: f.from, to: f.to })}
        />
      </div>
      <Filters value={f} onChange={setF} data={data} show={{ tag: true }} />
      <div className="stat-row">
        <div className="stat">
          <div className="stat__label">Hours</div>
          <div className="stat__value mono">{formatDuration(s.total.seconds)}</div>
        </div>
        <div className="stat">
          <div className="stat__label">Clients</div>
          <div className="stat__value">{s.clients.length}</div>
        </div>
      </div>
      {s.clients.length === 0 && <Alert tone="info">No hours were logged in this period.</Alert>}
      {s.clients.map((c) => (
        <section key={c.clientId} className="card" style={{ overflow: "auto" }}>
          <div className="card__header">
            <h2>{c.client?.name ?? "Unknown client"}</h2>
            <span className="mono">{formatDuration(c.sum.seconds)}</span>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Worked on</th>
                <th className="num">Hours</th>
              </tr>
            </thead>
            <tbody>
              {c.projects.map((p) => (
                <tr key={p.projectId}>
                  <td>{p.path}</td>
                  <td className="num mono">{formatDuration(p.sum.seconds)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td className="num mono">{formatDuration(c.sum.seconds)}</td>
              </tr>
            </tfoot>
          </table>
        </section>
      ))}
    </div>
  );
}
