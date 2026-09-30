import { dayOfWeek, formatDate, monthName, parseIsoDate } from "../dates.ts";
import type { ClientSummary, Line, MonthlyTimesheet, ProjectReport } from "../reports.ts";
import type { Organization, Tag } from "../schemas.ts";
import { type ExportDoc, type ExportTable, formatMoneyPlain, hm } from "./model.ts";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface DocOptions {
  organization: Organization;
  /** include rates and amounts (managers/admins, or members when allowed) */
  showMoney: boolean;
  generatedAt?: number;
  tags?: Tag[];
}

function orgBlock(o: Organization): ExportDoc["organization"] {
  return {
    name: o.name,
    logo: o.logo,
    address: o.settings.pdf.address,
    registration: o.settings.pdf.registration,
    vatNumber: o.settings.pdf.vatNumber,
    footer: o.settings.pdf.footer,
    accentColor: o.settings.pdf.accentColor,
  };
}

const fd = (o: Organization, d: string) => formatDate(d, o.settings.dateFormat);

type LineColumn =
  | "date"
  | "person"
  | "client"
  | "project"
  | "task"
  | "description"
  | "tags"
  | "billable"
  | "hours"
  | "billed"
  | "rate"
  | "amount";

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
      { key: "project", header: "Project", kind: "text", width: 2.6 },
      { key: "task", header: "Task", kind: "text", width: 1.5 },
      { key: "description", header: "Description", kind: "text", width: 3 },
      { key: "tags", header: "Tags", kind: "text", width: 1.2 },
      { key: "billable", header: "Billable", kind: "text", width: 0.9 },
      { key: "hours", header: "Hours", kind: "hours", width: 0.9 },
      { key: "billed", header: "Billed", kind: "hours", width: 0.9 },
      ...(opts.showMoney
        ? ([
            { key: "rate", header: "Rate", kind: "money", width: 1.3 },
            { key: "amount", header: "Amount", kind: "money", width: 1.4 },
          ] as const)
        : []),
    ],
    rows: lines.map((l) => ({
      date: fd(o, l.date),
      person: l.user?.name ?? "",
      client: l.client?.name ?? "",
      project: l.projectPath,
      task: l.task?.name ?? "",
      description: l.entry.description,
      tags: l.entry.tagIds
        .map((t) => tagName.get(t) ?? "")
        .filter(Boolean)
        .join(", "),
      billable: l.billable ? "Yes" : "No",
      hours: l.seconds,
      billed: l.billedSeconds,
      rate: l.rate,
      amount: l.billable ? l.amount : null,
    })),
    totals: {
      date: "Total",
      hours: lines.reduce((s, l) => s + l.seconds, 0),
      billed: lines.reduce((s, l) => s + l.billedSeconds, 0),
      amount: lines.reduce((s, l) => s + l.amount, 0),
    },
  };
  table.columns = table.columns.filter((c) => !skip.has(c.key));
  return table;
}

export function monthlyTimesheetDoc(m: MonthlyTimesheet, opts: DocOptions & { status?: string }): ExportDoc {
  const o = opts.organization;
  const { y, m: mo } = parseIsoDate(m.from);
  const period = `${monthName(mo)} ${y}`;
  const name = m.user?.name ?? "Unknown";
  const billable = m.total.billableSeconds;
  const worked = m.total.seconds;
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
      ["Billable", hm(billable)],
      ["Internal", hm(m.internalSeconds)],
      ["Expected", hm(m.expectedSeconds)],
    ],
    tables: [
      {
        title: "Summary by project",
        columns: [
          { key: "client", header: "Client", kind: "text", width: 2 },
          { key: "project", header: "Project", kind: "text", width: 3.5 },
          { key: "billable", header: "Billable", kind: "hours", width: 1 },
          { key: "other", header: "Non-billable", kind: "hours", width: 1.1 },
          { key: "total", header: "Total", kind: "hours", width: 1 },
        ],
        rows: m.byProject.map((p) => ({
          client: p.client?.name ?? "",
          project: p.path,
          billable: p.sum.billableSeconds,
          other: p.sum.seconds - p.sum.billableSeconds,
          total: p.sum.seconds,
        })),
        totals: { client: "Total", billable, other: worked - billable, total: worked },
      },
      {
        title: "Daily totals",
        columns: [
          { key: "date", header: "Date", kind: "date", width: 1.4 },
          { key: "day", header: "Day", kind: "text", width: 0.8 },
          { key: "billable", header: "Billable", kind: "hours", width: 1 },
          { key: "other", header: "Non-billable", kind: "hours", width: 1.1 },
          { key: "total", header: "Total", kind: "hours", width: 1 },
          { key: "expected", header: "Expected", kind: "hours", width: 1 },
        ],
        rows: m.days.map((d) => ({
          date: fd(o, d.date),
          day: DAYS[dayOfWeek(d.date)]!,
          billable: d.sum.billableSeconds || null,
          other: d.sum.seconds - d.sum.billableSeconds || null,
          total: d.sum.seconds || null,
          expected: d.expectedSeconds || null,
        })),
        totals: {
          date: "Total",
          billable,
          other: worked - billable,
          total: worked,
          expected: m.expectedSeconds,
        },
      },
      linesTable(m.lines, { ...opts, showMoney: false }, "All entries", [
        "person",
        "client",
        "tags",
        "billed",
      ]),
    ],
    signatures: ["Employee signature", "Approved by (manager)"],
    currency: o.settings.currency,
    organization: orgBlock(o),
    generatedAt: opts.generatedAt ?? Date.now(),
  };
}

export function projectReportDoc(
  r: ProjectReport,
  opts: DocOptions & { from: string; to: string },
): ExportDoc {
  const o = opts.organization;
  const money = opts.showMoney;
  const sumCols = [
    { key: "total", header: "Hours", kind: "hours" as const, width: 1 },
    { key: "billable", header: "Billable", kind: "hours" as const, width: 1 },
    ...(money ? [{ key: "amount", header: "Amount", kind: "money" as const, width: 1.4 }] : []),
  ];
  const s = (x: { seconds: number; billableSeconds: number; amount: number }) => ({
    total: x.seconds,
    billable: x.billableSeconds,
    amount: x.amount,
  });
  const budget = r.project?.budgetMinutes
    ? `${Math.round((r.total.seconds / (r.project.budgetMinutes * 60)) * 100)}% of ${Math.round(r.project.budgetMinutes / 60)} h`
    : "No budget";
  return {
    title: "Project timesheet",
    subtitle: `${r.path}${r.client ? ` · ${r.client.name}` : ""}`,
    meta: [
      ["Project", r.path],
      ["Client", r.client?.name ?? ""],
      ["Period", `${fd(o, opts.from)} – ${fd(o, opts.to)}`],
      ["Budget", budget],
    ],
    figures: [
      ["Total hours", hm(r.total.seconds)],
      ["Billable hours", hm(r.total.billableSeconds)],
      ...(money
        ? ([["Billable amount", formatMoneyPlain(r.total.amount, o.settings.currency)]] as [string, string][])
        : []),
      ["Entries", String(r.total.entries)],
    ],
    tables: [
      {
        title: "By person",
        columns: [{ key: "name", header: "Person", kind: "text", width: 4 }, ...sumCols],
        rows: r.byPerson.map((p) => ({ name: p.user?.name ?? "Unknown", ...s(p.sum) })),
        totals: { name: "Total", ...s(r.total) },
      },
      {
        title: "By sub-project",
        columns: [{ key: "name", header: "Project", kind: "text", width: 4 }, ...sumCols],
        rows: r.bySubproject.map((p) => ({ name: p.path, ...s(p.sum) })),
        totals: { name: "Total", ...s(r.total) },
      },
      {
        title: "By task",
        columns: [{ key: "name", header: "Task", kind: "text", width: 4 }, ...sumCols],
        rows: r.byTask.map((t) => ({ name: t.task?.name ?? "(no task)", ...s(t.sum) })),
        totals: { name: "Total", ...s(r.total) },
      },
      linesTable(r.lines, opts, "Entries", ["client", "tags", "billed", "rate"]),
    ],
    currency: o.settings.currency,
    organization: orgBlock(o),
    generatedAt: opts.generatedAt ?? Date.now(),
  };
}

export function clientSummaryDoc(
  c: ClientSummary,
  opts: DocOptions & { from: string; to: string },
): ExportDoc {
  const o = opts.organization;
  const money = opts.showMoney;
  return {
    title: "Client summary",
    subtitle: `Billable time · ${fd(o, opts.from)} – ${fd(o, opts.to)}`,
    meta: [
      ["Period", `${fd(o, opts.from)} – ${fd(o, opts.to)}`],
      ["Clients", String(c.clients.length)],
    ],
    figures: [
      ["Billable hours", hm(c.total.billableBilledSeconds)],
      ...(money
        ? ([["Amount (excl. VAT)", formatMoneyPlain(c.total.amount, o.settings.currency)]] as [
            string,
            string,
          ][])
        : []),
    ],
    tables: c.clients.map((cl) => ({
      title: cl.client?.name ?? "Unknown client",
      columns: [
        { key: "project", header: "Project", kind: "text", width: 4 },
        { key: "hours", header: "Billable hours", kind: "hours", width: 1.2 },
        ...(money ? [{ key: "amount", header: "Amount", kind: "money" as const, width: 1.4 }] : []),
      ],
      rows: cl.projects.map((p) => ({
        project: p.path,
        hours: p.sum.billableBilledSeconds,
        amount: p.sum.amount,
      })),
      totals: { project: "Total", hours: cl.sum.billableBilledSeconds, amount: cl.sum.amount },
    })),
    notes:
      o.settings.rounding.mode === "none"
        ? "Hours are exact."
        : `Hours are rounded ${o.settings.rounding.mode === "nearest" ? "to the nearest" : o.settings.rounding.mode} ${o.settings.rounding.minutes} minutes per entry.`,
    currency: o.settings.currency,
    organization: orgBlock(o),
    generatedAt: opts.generatedAt ?? Date.now(),
  };
}
