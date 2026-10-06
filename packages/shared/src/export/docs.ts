import { dayOfWeek, formatDate, monthName, parseIsoDate } from "../dates.ts";
import type { ClientSummary, Line, MonthlyTimesheet, ProjectReport } from "../reports.ts";
import type { Organization, Tag } from "../schemas.ts";
import { type ExportDoc, type ExportTable, hm } from "./model.ts";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface DocOptions {
  organization: Organization;
  generatedAt?: number;
  tags?: Tag[];
}

function orgBlock(o: Organization): ExportDoc["organization"] {
  return {
    name: o.name,
    logo: o.logo,
    address: o.settings.pdf.address,
    registration: o.settings.pdf.registration,
    footer: o.settings.pdf.footer,
    accentColor: o.settings.pdf.accentColor,
  };
}

const fd = (o: Organization, d: string) => formatDate(d, o.settings.dateFormat);

type LineColumn = "date" | "person" | "client" | "project" | "description" | "tags" | "hours";

export function linesTable(
  lines: Line[],
  opts: DocOptions,
  title = "Entries",
  omit: LineColumn[] = [],
): ExportTable {
  const tagName = new Map((opts.tags ?? []).map((t) => [t.id, t.name]));
  const o = opts.organization;
  const skip = new Set<string>(omit);
  const table: ExportTable = {
    title,
    columns: [
      { key: "date", header: "Date", kind: "date", width: 1.3 },
      { key: "person", header: "Person", kind: "text", width: 1.6 },
      { key: "client", header: "Client", kind: "text", width: 1.8 },
      { key: "project", header: "Worked on", kind: "text", width: 3.4 },
      { key: "description", header: "Note", kind: "text", width: 3 },
      { key: "tags", header: "Tags", kind: "text", width: 1.2 },
      { key: "hours", header: "Hours", kind: "hours", width: 0.9 },
    ],
    rows: lines.map((l) => ({
      date: fd(o, l.date),
      person: l.user?.name ?? "",
      client: l.client?.name ?? "",
      project: l.root?.code ? `${l.root.code} ${l.projectPath}` : l.projectPath,
      description: l.entry.description,
      tags: l.entry.tagIds
        .map((t) => tagName.get(t) ?? "")
        .filter(Boolean)
        .join(", "),
      hours: l.seconds,
    })),
    totals: { date: "Total", hours: lines.reduce((s, l) => s + l.seconds, 0) },
  };
  table.columns = table.columns.filter((c) => !skip.has(c.key));
  return table;
}

export function monthlyTimesheetDoc(m: MonthlyTimesheet, opts: DocOptions & { status?: string }): ExportDoc {
  const o = opts.organization;
  const { y, m: mo } = parseIsoDate(m.from);
  const period = `${monthName(mo)} ${y}`;
  const name = m.user?.name ?? "Unknown";
  const worked = m.total.seconds;
  const client = worked - m.internalSeconds;
  return {
    title: "Monthly timesheet",
    subtitle: `${name} · ${period}`,
    meta: [
      ["Employee", name],
      ["Period", `${fd(o, m.from)} – ${fd(o, m.to)}`],
      ["Email", m.user?.email ?? ""],
      ["Status", opts.status ?? "Not submitted"],
    ],
    figures: [
      ["Hours worked", hm(worked)],
      ["Client work", hm(client)],
      ["Internal", hm(m.internalSeconds)],
      ["Expected", hm(m.expectedSeconds)],
    ],
    tables: [
      {
        title: "Summary by project",
        columns: [
          { key: "client", header: "Client", kind: "text", width: 2 },
          { key: "project", header: "Worked on", kind: "text", width: 4.5 },
          { key: "total", header: "Hours", kind: "hours", width: 1 },
        ],
        rows: m.byProject.map((p) => ({
          client: p.client?.name ?? "",
          project: p.path,
          total: p.sum.seconds,
        })),
        totals: { client: "Total", total: worked },
      },
      {
        title: "Daily totals",
        columns: [
          { key: "date", header: "Date", kind: "date", width: 1.4 },
          { key: "day", header: "Day", kind: "text", width: 0.8 },
          { key: "total", header: "Hours", kind: "hours", width: 1 },
          { key: "expected", header: "Expected", kind: "hours", width: 1 },
        ],
        rows: m.days.map((d) => ({
          date: fd(o, d.date),
          day: DAYS[dayOfWeek(d.date)]!,
          total: d.sum.seconds || null,
          expected: d.expectedSeconds || null,
        })),
        totals: { date: "Total", total: worked, expected: m.expectedSeconds },
      },
      linesTable(m.lines, opts, "All entries", ["person", "client", "tags"]),
    ],
    signatures: ["Employee signature", "Approved by (manager)"],
    organization: orgBlock(o),
    generatedAt: opts.generatedAt ?? Date.now(),
  };
}

export function projectReportDoc(
  r: ProjectReport,
  opts: DocOptions & { from: string; to: string },
): ExportDoc {
  const o = opts.organization;
  const hoursCol = { key: "total", header: "Hours", kind: "hours" as const, width: 1 };
  const budget = r.project?.budgetMinutes
    ? `${Math.round((r.total.seconds / (r.project.budgetMinutes * 60)) * 100)}% of ${Math.round(r.project.budgetMinutes / 60)} h`
    : "No budget";
  const code = r.project?.code ? `${r.project.code} ` : "";
  return {
    title: "Project timesheet",
    subtitle: `${code}${r.path}${r.client ? ` · ${r.client.name}` : ""}`,
    meta: [
      ["Project", `${code}${r.path}`],
      ["Client", r.client?.name ?? ""],
      ["Period", `${fd(o, opts.from)} – ${fd(o, opts.to)}`],
      ["Budget", budget],
    ],
    figures: [
      ["Total hours", hm(r.total.seconds)],
      ["People", String(r.byPerson.length)],
      ["Entries", String(r.total.entries)],
    ],
    tables: [
      {
        title: "By person",
        columns: [{ key: "name", header: "Person", kind: "text", width: 4 }, hoursCol],
        rows: r.byPerson.map((p) => ({ name: p.user?.name ?? "Unknown", total: p.sum.seconds })),
        totals: { name: "Total", total: r.total.seconds },
      },
      {
        title: "By item",
        columns: [{ key: "name", header: "Item", kind: "text", width: 4 }, hoursCol],
        rows: r.byItem.map((p) => ({ name: p.path, total: p.sum.seconds })),
        totals: { name: "Total", total: r.total.seconds },
      },
      linesTable(r.lines, opts, "Entries", ["client", "tags"]),
    ],
    organization: orgBlock(o),
    generatedAt: opts.generatedAt ?? Date.now(),
  };
}

export function clientSummaryDoc(
  c: ClientSummary,
  opts: DocOptions & { from: string; to: string },
): ExportDoc {
  const o = opts.organization;
  return {
    title: "Client summary",
    subtitle: `Hours · ${fd(o, opts.from)} – ${fd(o, opts.to)}`,
    meta: [
      ["Period", `${fd(o, opts.from)} – ${fd(o, opts.to)}`],
      ["Clients", String(c.clients.length)],
    ],
    figures: [["Total hours", hm(c.total.seconds)]],
    tables: c.clients.map((cl) => ({
      title: cl.client?.name ?? "Unknown client",
      columns: [
        { key: "project", header: "Worked on", kind: "text", width: 4 },
        { key: "hours", header: "Hours", kind: "hours", width: 1.2 },
      ],
      rows: cl.projects.map((p) => ({ project: p.path, hours: p.sum.seconds })),
      totals: { project: "Total", hours: cl.sum.seconds },
    })),
    organization: orgBlock(o),
    generatedAt: opts.generatedAt ?? Date.now(),
  };
}
