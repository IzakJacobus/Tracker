import { flattenTree, formatDuration, projectReport } from "@stint/shared";
import { projectReportDoc } from "@stint/shared/export";
import { FolderTree } from "lucide-react";
import { useMemo, useState } from "react";
import { useMe } from "../../app/session.tsx";
import { useProjectTree } from "../../data/hooks.ts";
import { fmtDate, formatMoney } from "../../lib/format.ts";
import { useSettings } from "../../tracking/hooks.ts";
import { Field, Select } from "../../ui/Field.tsx";
import { EmptyState } from "../../ui/misc.tsx";
import { useReportData, useToday } from "./data.ts";
import { ExportButtons, useDocOptions } from "./exporting.tsx";
import { type FilterState, Filters, initialFilter, toReportFilter } from "./Filters.tsx";

export function ProjectReportPage() {
  const me = useMe();
  const settings = useSettings();
  const today = useToday();
  const data = useReportData();
  const tree = useProjectTree(data?.projects ?? []);
  const [projectId, setProjectId] = useState("");
  const [f, setF] = useState<FilterState>(() => initialFilter(today, settings.weekStart, "this-month"));
  const opts = useDocOptions(data?.tags ?? []);
  const money = me.permissions.seeRates;
  const options = useMemo(() => flattenTree(tree), [tree]);
  // Default: the client project with the most time in the period.
  const busiest = useMemo(() => {
    if (!data) return "";
    const internal = new Set(data.clients.filter((c) => c.isInternal).map((c) => c.id));
    const roots = new Map<string, number>();
    for (const e of data.entries) {
      if (e.entryDate < f.from || e.entryDate > f.to || !e.durationS) continue;
      let p = tree.byId.get(e.projectId);
      while (p?.parentId && tree.byId.get(p.parentId)) p = tree.byId.get(p.parentId);
      if (p && !internal.has(p.clientId)) roots.set(p.id, (roots.get(p.id) ?? 0) + e.durationS);
    }
    return [...roots].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  }, [data, tree, f.from, f.to]);
  const pid = projectId || busiest || options[0]?.node.id || "";
  const r = useMemo(
    () => (data && pid ? projectReport(data, pid, toReportFilter({ ...f, projectId: "" })) : null),
    [data, pid, f],
  );
  if (!data) return null;
  if (!r) return <EmptyState icon={<FolderTree />} title="No projects yet" />;

  const sumCells = (s: { seconds: number; billableSeconds: number; amount: number }) => (
    <>
      <td className="num mono">{formatDuration(s.seconds)}</td>
      <td className="num mono">{formatDuration(s.billableSeconds)}</td>
      {money && <td className="num tnum">{formatMoney(s.amount, settings.currency)}</td>}
    </>
  );
  const head = (label: string) => (
    <thead>
      <tr>
        <th>{label}</th>
        <th className="num">Hours</th>
        <th className="num">Billable</th>
        {money && <th className="num">Amount</th>}
      </tr>
    </thead>
  );

  return (
    <div className="stack stack--lg">
      <div className="filters">
        <Field label="Project">
          <Select value={pid} onChange={(e) => setProjectId(e.target.value)}>
            {options.map(({ node, depth }) => (
              <option key={node.id} value={node.id}>
                {"  ".repeat(depth)}
                {node.name}
                {node.archivedAt ? " (archived)" : ""}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grow" />
        <ExportButtons
          fileBase={`Project ${r.path} ${f.from} to ${f.to}`}
          lines={r.lines}
          tags={data.tags}
          buildDoc={() => projectReportDoc(r, { ...opts, from: f.from, to: f.to })}
        />
      </div>
      <Filters value={f} onChange={setF} data={data} show={{ client: false, project: false }} />
      <div className="stat-row">
        <div className="stat">
          <div className="stat__label">Total hours</div>
          <div className="stat__value mono">{formatDuration(r.total.seconds)}</div>
          <div className="stat__sub">including all sub-projects</div>
        </div>
        <div className="stat">
          <div className="stat__label">Billable hours</div>
          <div className="stat__value mono">{formatDuration(r.total.billableSeconds)}</div>
        </div>
        {money && (
          <div className="stat">
            <div className="stat__label">Billable amount</div>
            <div className="stat__value">{formatMoney(r.total.amount, settings.currency)}</div>
          </div>
        )}
      </div>
      <div className="report-grid">
        <section className="card" style={{ overflow: "auto" }}>
          <div className="card__header">
            <h2>By sub-project</h2>
          </div>
          <table className="table">
            {head("Project")}
            <tbody>
              {r.bySubproject.map((p) => (
                <tr key={p.projectId}>
                  <td>{p.path}</td>
                  {sumCells(p.sum)}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <div className="stack">
          <section className="card" style={{ overflow: "auto" }}>
            <div className="card__header">
              <h2>By person</h2>
            </div>
            <table className="table">
              {head("Person")}
              <tbody>
                {r.byPerson.map((p) => (
                  <tr key={p.userId}>
                    <td>{p.user?.name ?? "Unknown"}</td>
                    {sumCells(p.sum)}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="card" style={{ overflow: "auto" }}>
            <div className="card__header">
              <h2>By task</h2>
            </div>
            <table className="table">
              {head("Task")}
              <tbody>
                {r.byTask.map((t) => (
                  <tr key={t.taskId ?? "none"}>
                    <td>{t.task?.name ?? <span className="subtle">No task</span>}</td>
                    {sumCells(t.sum)}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      </div>
      <section className="card" style={{ overflow: "auto" }}>
        <div className="card__header">
          <h2>Entries</h2>
          <span className="subtle">{r.lines.length}</span>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Person</th>
              <th>Project</th>
              <th>Task</th>
              <th>Description</th>
              <th className="num">Hours</th>
              {money && <th className="num">Amount</th>}
            </tr>
          </thead>
          <tbody>
            {r.lines.slice(0, 500).map((l) => (
              <tr key={l.entry.id}>
                <td className="mono">{fmtDate(l.date, settings)}</td>
                <td>{l.user?.name}</td>
                <td>{l.projectPath}</td>
                <td>{l.task?.name}</td>
                <td>{l.entry.description}</td>
                <td className="num mono">{formatDuration(l.seconds)}</td>
                {money && (
                  <td className="num tnum">{l.billable ? formatMoney(l.amount, settings.currency) : "—"}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {r.lines.length > 500 && (
          <p className="subtle grid-hint">Showing the first 500 entries. Export to see them all.</p>
        )}
      </section>
    </div>
  );
}
