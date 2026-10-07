/**
 * Report builders: pure functions over entries and reference data. The same
 * code runs in the browser (reports work offline from the local copy) and on
 * the server. Everything is hours: durations are exact seconds.
 */
import { dateRange, dayOfWeek, endOfMonth, isWithin, startOfMonth } from "./dates.ts";
import { buildTree, subtreeIds, type Tree } from "./rollup.ts";
import type { Client, OrgSettings, Project, Tag, TimeEntry, User } from "./schemas.ts";

export interface ReportData {
  entries: TimeEntry[];
  projects: Project[];
  clients: Client[];
  users: User[];
  tags: Tag[];
  settings: OrgSettings;
}

export interface ReportFilter {
  from: string;
  to: string;
  clientIds?: string[];
  /** includes everything under each project or item */
  projectIds?: string[];
  userIds?: string[];
  tagIds?: string[];
}

export interface Line {
  entry: TimeEntry;
  date: string;
  user: User | undefined;
  /** The item the hours were logged on (a project, or anything under one). */
  project: Project | undefined;
  /** Its top-level project. */
  root: Project | undefined;
  projectPath: string;
  client: Client | undefined;
  seconds: number;
}

export interface Sum {
  seconds: number;
  entries: number;
}

export const emptySum = (): Sum => ({ seconds: 0, entries: 0 });

function add(s: Sum, l: Line): void {
  s.seconds += l.seconds;
  s.entries += 1;
}

export interface Context {
  tree: Tree<Project>;
  projects: Map<string, Project>;
  clients: Map<string, Client>;
  users: Map<string, User>;
  path: (projectId: string) => string;
  root: (projectId: string) => Project | undefined;
}

export function makeContext(d: Pick<ReportData, "projects" | "clients" | "users">): Context {
  const tree = buildTree(d.projects);
  const projects = new Map(d.projects.map((p) => [p.id, p]));
  const cache = new Map<string, string>();
  const lineage = (id: string): Project[] => {
    const out: Project[] = [];
    const seen = new Set<string>();
    let cur = projects.get(id);
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      out.unshift(cur);
      cur = cur.parentId ? projects.get(cur.parentId) : undefined;
    }
    return out;
  };
  const path = (id: string): string => {
    const hit = cache.get(id);
    if (hit !== undefined) return hit;
    const out =
      lineage(id)
        .map((p) => p.name)
        .join(" › ") || "(deleted project)";
    cache.set(id, out);
    return out;
  };
  return {
    tree,
    projects,
    clients: new Map(d.clients.map((c) => [c.id, c])),
    users: new Map(d.users.map((u) => [u.id, u])),
    path,
    root: (id) => lineage(id)[0],
  };
}

/** Filters entries and turns them into report lines (entries with hours only). */
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
    out.push({
      entry: e,
      date: e.entryDate,
      user: ctx.users.get(e.userId),
      project,
      root: ctx.root(e.projectId),
      projectPath: ctx.path(e.projectId),
      client: project ? ctx.clients.get(project.clientId) : undefined,
      seconds: e.durationS,
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
/* Project report                                                      */
/* ------------------------------------------------------------------ */

export interface ProjectReport {
  project: Project | undefined;
  path: string;
  client: Client | undefined;
  total: Sum;
  byPerson: { user: User | undefined; userId: string; sum: Sum }[];
  /** Hours per item they were logged on (the project itself or anything under it). */
  byItem: { projectId: string; path: string; sum: Sum }[];
  byDate: { date: string; sum: Sum }[];
  lines: Line[];
}

/** All hours on a project or item including everything under it, by person, item and date. */
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
    byItem: [...groupBy(lines, (l) => l.entry.projectId)]
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
/* Client summary                                                      */
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

/** Hours per client and item. The firm's own (Internal) work is listed last. */
export function clientSummary(d: ReportData, f: ReportFilter): ClientSummary {
  const ctx = makeContext(d);
  const lines = buildLines(d, f, ctx);
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
      .sort(
        (a, b) =>
          Number(a.client?.isInternal ?? false) - Number(b.client?.isInternal ?? false) ||
          (a.client?.name ?? "").localeCompare(b.client?.name ?? ""),
      ),
    total: total(lines),
  };
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

export interface Dashboard {
  period: Sum;
  /** hours on client work (not Internal) ÷ hours logged */
  clientShare: number;
  /** Hours on each project or item they were logged on (full path), biggest first. */
  byItem: {
    projectId: string;
    path: string;
    client: Client | undefined;
    color: string | undefined;
    sum: Sum;
  }[];
  topProjects: { projectId: string; path: string; client: Client | undefined; sum: Sum }[];
  byClient: { clientId: string; client: Client | undefined; sum: Sum }[];
  byPerson: { user: User | undefined; userId: string; sum: Sum }[];
}

export function dashboard(d: ReportData, f: ReportFilter, people: User[]): Dashboard {
  const ctx = makeContext(d);
  const lines = buildLines(d, f, ctx);
  const active = people.filter((u) => u.active);
  const t = total(lines);
  const clientSeconds = (ls: Line[]) =>
    ls.filter((l) => !l.client?.isInternal).reduce((s, l) => s + l.seconds, 0);
  return {
    period: t,
    clientShare: t.seconds ? clientSeconds(lines) / t.seconds : 0,
    byItem: [...groupBy(lines, (l) => l.entry.projectId)]
      .map(([projectId, g]) => ({
        projectId,
        path: ctx.path(projectId),
        client: g.lines[0]?.client,
        color: g.lines[0]?.root?.color,
        sum: g.sum,
      }))
      .sort((a, b) => b.sum.seconds - a.sum.seconds || a.path.localeCompare(b.path)),
    topProjects: [...groupBy(lines, (l) => l.root?.id ?? l.entry.projectId)]
      .map(([projectId, g]) => ({
        projectId,
        path: ctx.path(projectId),
        client: g.lines[0]?.client,
        sum: g.sum,
      }))
      .sort((a, b) => b.sum.seconds - a.sum.seconds)
      .slice(0, 8),
    byClient: [...groupBy(lines, (l) => l.client?.id ?? "")]
      .map(([clientId, g]) => ({ clientId, client: ctx.clients.get(clientId), sum: g.sum }))
      .sort((a, b) => b.sum.seconds - a.sum.seconds),
    byPerson: active
      .map((u) => ({
        userId: u.id,
        user: u,
        sum: total(lines.filter((l) => l.entry.userId === u.id)),
      }))
      .sort((a, b) => (a.user?.name ?? "").localeCompare(b.user?.name ?? "")),
  };
}
