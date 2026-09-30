/**
 * Report builders: pure functions over entries and reference data. The same
 * code runs in the browser (reports work offline from the local copy) and on
 * the server. Durations are exact seconds; `billed*` fields apply the
 * organisation's rounding rule per entry, as invoices do.
 */
import { dateRange, dayOfWeek, endOfMonth, isWithin, startOfMonth } from "./dates.ts";
import { amountFor } from "./rates.ts";
import { buildTree, subtreeIds, type Tree } from "./rollup.ts";
import { roundSeconds } from "./rounding.ts";
import type { Client, OrgSettings, Project, Tag, Task, TimeEntry, User } from "./schemas.ts";

export interface ReportData {
  entries: TimeEntry[];
  projects: Project[];
  clients: Client[];
  tasks: Task[];
  users: User[];
  tags: Tag[];
  settings: OrgSettings;
}

export type BillableFilter = "all" | "billable" | "nonbillable";

export interface ReportFilter {
  from: string;
  to: string;
  clientIds?: string[];
  /** includes the whole subtree of each project */
  projectIds?: string[];
  userIds?: string[];
  tagIds?: string[];
  billable?: BillableFilter;
}

export interface Line {
  entry: TimeEntry;
  date: string;
  user: User | undefined;
  project: Project | undefined;
  projectPath: string;
  client: Client | undefined;
  task: Task | undefined;
  seconds: number;
  billedSeconds: number;
  billable: boolean;
  rate: number | null;
  amount: number;
}

export interface Sum {
  seconds: number;
  billedSeconds: number;
  billableSeconds: number;
  billableBilledSeconds: number;
  amount: number;
  entries: number;
}

export const emptySum = (): Sum => ({
  seconds: 0,
  billedSeconds: 0,
  billableSeconds: 0,
  billableBilledSeconds: 0,
  amount: 0,
  entries: 0,
});

function add(s: Sum, l: Line): void {
  s.seconds += l.seconds;
  s.billedSeconds += l.billedSeconds;
  if (l.billable) {
    s.billableSeconds += l.seconds;
    s.billableBilledSeconds += l.billedSeconds;
  }
  s.amount += l.amount;
  s.entries += 1;
}

export interface Context {
  tree: Tree<Project>;
  projects: Map<string, Project>;
  clients: Map<string, Client>;
  tasks: Map<string, Task>;
  users: Map<string, User>;
  path: (projectId: string) => string;
}

export function makeContext(d: Pick<ReportData, "projects" | "clients" | "tasks" | "users">): Context {
  const tree = buildTree(d.projects);
  const projects = new Map(d.projects.map((p) => [p.id, p]));
  const cache = new Map<string, string>();
  const path = (id: string): string => {
    const hit = cache.get(id);
    if (hit !== undefined) return hit;
    const names: string[] = [];
    const seen = new Set<string>();
    let cur = projects.get(id);
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      names.unshift(cur.name);
      cur = cur.parentId ? projects.get(cur.parentId) : undefined;
    }
    const out = names.join(" › ") || "(deleted project)";
    cache.set(id, out);
    return out;
  };
  return {
    tree,
    projects,
    clients: new Map(d.clients.map((c) => [c.id, c])),
    tasks: new Map(d.tasks.map((t) => [t.id, t])),
    users: new Map(d.users.map((u) => [u.id, u])),
    path,
  };
}

/** Filters entries and turns them into report lines (finished entries only). */
export function buildLines(d: ReportData, f: ReportFilter, ctx: Context = makeContext(d)): Line[] {
  const projectSet = f.projectIds?.length
    ? new Set(f.projectIds.flatMap((id) => subtreeIds(ctx.tree, id)))
    : null;
  const clientSet = f.clientIds?.length ? new Set(f.clientIds) : null;
  const userSet = f.userIds?.length ? new Set(f.userIds) : null;
  const tagSet = f.tagIds?.length ? new Set(f.tagIds) : null;
  const out: Line[] = [];
  for (const e of d.entries) {
    if (e.deletedAt || e.durationS === null) continue;
    if (!isWithin(e.entryDate, f.from, f.to)) continue;
    if (userSet && !userSet.has(e.userId)) continue;
    if (projectSet && !projectSet.has(e.projectId)) continue;
    const project = ctx.projects.get(e.projectId);
    if (clientSet && (!project || !clientSet.has(project.clientId))) continue;
    if (tagSet && !e.tagIds.some((t) => tagSet.has(t))) continue;
    if (f.billable === "billable" && !e.billable) continue;
    if (f.billable === "nonbillable" && e.billable) continue;
    const billed = roundSeconds(e.durationS, d.settings.rounding);
    out.push({
      entry: e,
      date: e.entryDate,
      user: ctx.users.get(e.userId),
      project,
      projectPath: ctx.path(e.projectId),
      client: project ? ctx.clients.get(project.clientId) : undefined,
      task: e.taskId ? ctx.tasks.get(e.taskId) : undefined,
      seconds: e.durationS,
      billedSeconds: billed,
      billable: e.billable,
      rate: e.rateSnapshot,
      amount: e.billable ? amountFor(billed, e.rateSnapshot) : 0,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.entry.startedAt - b.entry.startedAt);
}

function groupBy<K>(lines: Line[], key: (l: Line) => K): Map<K, { lines: Line[]; sum: Sum }> {
  const m = new Map<K, { lines: Line[]; sum: Sum }>();
  for (const l of lines) {
    const k = key(l);
    let g = m.get(k);
    if (!g) {
      g = { lines: [], sum: emptySum() };
      m.set(k, g);
    }
    g.lines.push(l);
    add(g.sum, l);
  }
  return m;
}

export function total(lines: Line[]): Sum {
  const s = emptySum();
  for (const l of lines) add(s, l);
  return s;
}

/* ------------------------------------------------------------------ */
/* Project timesheet                                                   */
/* ------------------------------------------------------------------ */

export interface ProjectReport {
  project: Project | undefined;
  path: string;
  client: Client | undefined;
  total: Sum;
  byPerson: { user: User | undefined; userId: string; sum: Sum }[];
  byTask: { task: Task | undefined; taskId: string | null; sum: Sum }[];
  bySubproject: { projectId: string; path: string; sum: Sum }[];
  byDate: { date: string; sum: Sum }[];
  lines: Line[];
}

/** All hours on a project including its sub-projects, grouped by person, task and date. */
export function projectReport(
  d: ReportData,
  projectId: string,
  f: Omit<ReportFilter, "projectIds">,
): ProjectReport {
  const ctx = makeContext(d);
  const lines = buildLines(d, { ...f, projectIds: [projectId] }, ctx);
  const project = ctx.projects.get(projectId);
  const bySort = <T extends { sum: Sum }>(a: T, b: T) => b.sum.seconds - a.sum.seconds;
  return {
    project,
    path: ctx.path(projectId),
    client: project ? ctx.clients.get(project.clientId) : undefined,
    total: total(lines),
    byPerson: [...groupBy(lines, (l) => l.entry.userId)]
      .map(([userId, g]) => ({ userId, user: ctx.users.get(userId), sum: g.sum }))
      .sort(bySort),
    byTask: [...groupBy(lines, (l) => l.entry.taskId)]
      .map(([taskId, g]) => ({ taskId, task: taskId ? ctx.tasks.get(taskId) : undefined, sum: g.sum }))
      .sort(bySort),
    bySubproject: [...groupBy(lines, (l) => l.entry.projectId)]
      .map(([id, g]) => ({ projectId: id, path: ctx.path(id), sum: g.sum }))
      .sort((a, b) => a.path.localeCompare(b.path)),
    byDate: [...groupBy(lines, (l) => l.date)]
      .map(([date, g]) => ({ date, sum: g.sum }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    lines,
  };
}

/* ------------------------------------------------------------------ */
/* Monthly timesheet per person                                        */
/* ------------------------------------------------------------------ */

export interface MonthlyTimesheet {
  user: User | undefined;
  month: string; // YYYY-MM
  from: string;
  to: string;
  days: { date: string; working: boolean; expectedSeconds: number; sum: Sum; lines: Line[] }[];
  byProject: { projectId: string; path: string; client: Client | undefined; internal: boolean; sum: Sum }[];
  total: Sum;
  internalSeconds: number;
  expectedSeconds: number;
  lines: Line[];
}

/** Every hour one person worked in a month, across all projects — the document staff hand in. */
export function monthlyTimesheet(d: ReportData, userId: string, month: string): MonthlyTimesheet {
  const ctx = makeContext(d);
  const from = startOfMonth(`${month}-01`);
  const to = endOfMonth(from);
  const lines = buildLines(d, { from, to, userIds: [userId] }, ctx);
  const byDate = groupBy(lines, (l) => l.date);
  const days = dateRange(from, to).map((date) => {
    const working = d.settings.workingDays.includes(dayOfWeek(date));
    const g = byDate.get(date);
    return {
      date,
      working,
      expectedSeconds: working ? d.settings.workdayMinutes * 60 : 0,
      sum: g?.sum ?? emptySum(),
      lines: g?.lines ?? [],
    };
  });
  const byProject = [...groupBy(lines, (l) => l.entry.projectId)]
    .map(([projectId, g]) => {
      const client = g.lines[0]?.client;
      return {
        projectId,
        path: ctx.path(projectId),
        client,
        internal: client?.isInternal ?? false,
        sum: g.sum,
      };
    })
    .sort(
      (a, b) =>
        Number(a.internal) - Number(b.internal) ||
        (a.client?.name ?? "").localeCompare(b.client?.name ?? "") ||
        a.path.localeCompare(b.path),
    );
  const t = total(lines);
  return {
    user: ctx.users.get(userId),
    month,
    from,
    to,
    days,
    byProject,
    total: t,
    internalSeconds: lines.filter((l) => l.client?.isInternal).reduce((s, l) => s + l.seconds, 0),
    expectedSeconds: days.reduce((s, x) => s + x.expectedSeconds, 0),
    lines,
  };
}

/* ------------------------------------------------------------------ */
/* Client summary (for invoicing)                                      */
/* ------------------------------------------------------------------ */

export interface ClientSummary {
  clients: {
    client: Client | undefined;
    clientId: string;
    projects: { projectId: string; path: string; sum: Sum }[];
    sum: Sum;
  }[];
  total: Sum;
}

/** Billable hours and amounts per client and project. Internal work is excluded. */
export function clientSummary(d: ReportData, f: ReportFilter): ClientSummary {
  const ctx = makeContext(d);
  const lines = buildLines(d, { ...f, billable: "billable" }, ctx).filter((l) => !l.client?.isInternal);
  const byClient = groupBy(lines, (l) => l.client?.id ?? "");
  return {
    clients: [...byClient]
      .map(([clientId, g]) => ({
        clientId,
        client: ctx.clients.get(clientId),
        projects: [...groupBy(g.lines, (l) => l.entry.projectId)]
          .map(([projectId, pg]) => ({ projectId, path: ctx.path(projectId), sum: pg.sum }))
          .sort((a, b) => a.path.localeCompare(b.path)),
        sum: g.sum,
      }))
      .sort((a, b) => (a.client?.name ?? "").localeCompare(b.client?.name ?? "")),
    total: total(lines),
  };
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

export interface Dashboard {
  period: Sum;
  capacitySeconds: number;
  /** billable hours ÷ capacity */
  utilisation: number;
  /** billable hours ÷ hours worked */
  billableShare: number;
  byDay: { date: string; billableSeconds: number; otherSeconds: number }[];
  topProjects: { projectId: string; path: string; client: Client | undefined; sum: Sum }[];
  byPerson: { user: User | undefined; userId: string; sum: Sum; capacitySeconds: number }[];
}

export function dashboard(d: ReportData, f: ReportFilter, people: User[]): Dashboard {
  const ctx = makeContext(d);
  const lines = buildLines(d, f, ctx);
  const workingDays = dateRange(f.from, f.to).filter((x) =>
    d.settings.workingDays.includes(dayOfWeek(x)),
  ).length;
  const perDay = d.settings.workingDays.length || 5;
  const capacityFor = (u: User) => Math.round((u.weeklyCapacityMinutes * 60 * workingDays) / perDay);
  const active = people.filter((u) => u.active);
  const capacitySeconds = active.reduce((s, u) => s + capacityFor(u), 0);
  const t = total(lines);
  const byDate = groupBy(lines, (l) => l.date);
  return {
    period: t,
    capacitySeconds,
    utilisation: capacitySeconds ? t.billableSeconds / capacitySeconds : 0,
    billableShare: t.seconds ? t.billableSeconds / t.seconds : 0,
    byDay: dateRange(f.from, f.to).map((date) => {
      const s = byDate.get(date)?.sum ?? emptySum();
      return { date, billableSeconds: s.billableSeconds, otherSeconds: s.seconds - s.billableSeconds };
    }),
    topProjects: [...groupBy(lines, (l) => l.entry.projectId)]
      .map(([projectId, g]) => ({
        projectId,
        path: ctx.path(projectId),
        client: g.lines[0]?.client,
        sum: g.sum,
      }))
      .sort((a, b) => b.sum.seconds - a.sum.seconds)
      .slice(0, 8),
    byPerson: active
      .map((u) => ({
        userId: u.id,
        user: u,
        sum: total(lines.filter((l) => l.entry.userId === u.id)),
        capacitySeconds: capacityFor(u),
      }))
      .sort((a, b) => (a.user?.name ?? "").localeCompare(b.user?.name ?? "")),
  };
}
