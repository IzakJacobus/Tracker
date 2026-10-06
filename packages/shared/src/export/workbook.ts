import type { Client, Project, Tag, TimeEntry, User } from "../schemas.ts";
import type { ExportTable } from "./model.ts";
import { type Sheet, toXlsx } from "./xlsx.ts";
import { readXlsx, rowsToCsv } from "./xlsxRead.ts";

/**
 * The Excel workbook for moving data in and out of Stint. Two sheets, which the importers read back:
 *  - "Projects": every project and item (client, project code, path, type, item code, done, budget).
 *  - "Hours": every entry (date, person, email, client, project code, path, hours, note, tags).
 */
export const PATH_SEPARATOR = " › ";

export const PROJECT_COLUMNS = [
  "Client",
  "Project code",
  "Path",
  "Type",
  "Item code",
  "Done",
  "Budget hours",
] as const;
export const HOURS_COLUMNS = [
  "Date",
  "Person",
  "Email",
  "Client",
  "Project code",
  "Project",
  "Hours",
  "Note",
  "Tags",
] as const;

export interface WorkbookData {
  projects: Project[];
  clients: Client[];
  users: User[];
  tags: Tag[];
  entries: TimeEntry[];
}

const text = (key: string, header: string, width?: number) => ({ key, header, kind: "text" as const, width });

export function projectsTable(d: Pick<WorkbookData, "projects" | "clients">): ExportTable {
  const live = d.projects.filter((p) => !p.deletedAt);
  const children = new Map<string | null, Project[]>();
  for (const p of live) {
    const list = children.get(p.parentId) ?? [];
    list.push(p);
    children.set(p.parentId, list);
  }
  const order = (a: Project, b: Project) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
  const clients = [...d.clients]
    .filter((c) => !c.deletedAt)
    .sort((a, b) => Number(a.isInternal) - Number(b.isInternal) || a.name.localeCompare(b.name));
  const rows: ExportTable["rows"] = [];
  for (const c of clients) {
    const walk = (p: Project, path: string[], rootCode: string) => {
      const here = [...path, p.name];
      rows.push({
        client: c.name,
        projectCode: rootCode,
        path: here.join(PATH_SEPARATOR),
        kind: p.kind ?? "",
        itemCode: p.parentId ? (p.code ?? "") : "",
        done: p.archivedAt ? "Yes" : "",
        budget: p.budgetMinutes ? Math.round((p.budgetMinutes / 60) * 10_000) / 10_000 : null,
      });
      for (const k of [...(children.get(p.id) ?? [])].sort(order)) walk(k, here, rootCode);
    };
    const roots = (children.get(null) ?? []).filter((p) => p.clientId === c.id).sort(order);
    for (const r of roots) walk(r, [], r.code ?? "");
  }
  return {
    title: "Projects",
    columns: [
      text("client", PROJECT_COLUMNS[0], 26),
      text("projectCode", PROJECT_COLUMNS[1], 16),
      text("path", PROJECT_COLUMNS[2], 52),
      text("kind", PROJECT_COLUMNS[3], 16),
      text("itemCode", PROJECT_COLUMNS[4], 14),
      text("done", PROJECT_COLUMNS[5], 8),
      { key: "budget", header: PROJECT_COLUMNS[6], kind: "decimal" as const, width: 14 },
    ],
    rows,
  };
}

export function hoursTable(
  d: Pick<WorkbookData, "projects" | "clients" | "users" | "tags" | "entries">,
  range?: { from?: string; to?: string },
): ExportTable {
  const project = new Map(d.projects.map((p) => [p.id, p]));
  const client = new Map(d.clients.map((c) => [c.id, c]));
  const user = new Map(d.users.map((u) => [u.id, u]));
  const tag = new Map(d.tags.map((t) => [t.id, t.name]));
  const pathOf = (id: string): { path: string; root: Project | undefined } => {
    const names: string[] = [];
    const seen = new Set<string>();
    let root: Project | undefined;
    for (
      let cur = project.get(id);
      cur && !seen.has(cur.id);
      cur = cur.parentId ? project.get(cur.parentId) : undefined
    ) {
      seen.add(cur.id);
      names.unshift(cur.name);
      root = cur;
    }
    return { path: names.join(PATH_SEPARATOR), root };
  };
  const entries = d.entries
    .filter(
      (e) =>
        !e.deletedAt &&
        e.durationS !== null &&
        (!range?.from || e.entryDate >= range.from) &&
        (!range?.to || e.entryDate <= range.to),
    )
    .sort((a, b) => a.entryDate.localeCompare(b.entryDate) || a.startedAt - b.startedAt);
  return {
    title: "Hours",
    columns: [
      { key: "date", header: HOURS_COLUMNS[0], kind: "date" as const, width: 12 },
      text("person", HOURS_COLUMNS[1], 22),
      text("email", HOURS_COLUMNS[2], 28),
      text("client", HOURS_COLUMNS[3], 24),
      text("projectCode", HOURS_COLUMNS[4], 14),
      text("project", HOURS_COLUMNS[5], 50),
      { key: "hours", header: HOURS_COLUMNS[6], kind: "decimal" as const, width: 10 },
      text("note", HOURS_COLUMNS[7], 36),
      text("tags", HOURS_COLUMNS[8], 20),
    ],
    rows: entries.map((e) => {
      const { path, root } = pathOf(e.projectId);
      const u = user.get(e.userId);
      const p = project.get(e.projectId);
      return {
        date: e.entryDate,
        person: u?.name ?? "",
        email: u?.email ?? "",
        client: (p ? client.get(p.clientId)?.name : "") ?? "",
        projectCode: root?.code ?? "",
        project: path,
        hours: Math.round(((e.durationS ?? 0) / 3600) * 10_000) / 10_000,
        note: e.description,
        tags: e.tagIds
          .map((t) => tag.get(t) ?? "")
          .filter(Boolean)
          .join(", "),
      };
    }),
  };
}

/** The workbook to download: Projects and Hours, ready to edit and import again. */
export function exportWorkbook(d: WorkbookData, range?: { from?: string; to?: string }): Uint8Array {
  const sheets: Sheet[] = [
    { name: "Projects", table: projectsTable(d) },
    { name: "Hours", table: hoursTable(d, range) },
  ];
  return toXlsx(sheets);
}

/** An empty workbook with the right headings, an example row and a "How to use" sheet. */
export function templateWorkbook(): Uint8Array {
  const projects: ExportTable = {
    ...projectsTable({ projects: [], clients: [] }),
    rows: [
      {
        client: "Acme Engineering",
        projectCode: "2026-001",
        path: "Bridge upgrade",
        kind: "",
        itemCode: "",
        done: "",
        budget: 900,
      },
      {
        client: "Acme Engineering",
        projectCode: "2026-001",
        path: `Bridge upgrade${PATH_SEPARATOR}Design`,
        kind: "Phase",
        itemCode: "",
        done: "",
        budget: null,
      },
      {
        client: "Acme Engineering",
        projectCode: "2026-001",
        path: `Bridge upgrade${PATH_SEPARATOR}Design${PATH_SEPARATOR}Pier design`,
        kind: "Task",
        itemCode: "D-01",
        done: "",
        budget: null,
      },
    ],
  };
  const hours: ExportTable = {
    ...hoursTable({ projects: [], clients: [], users: [], tags: [], entries: [] }),
    rows: [
      {
        date: "2026-09-28",
        person: "Aisha Patel",
        email: "aisha@example.com",
        client: "Acme Engineering",
        projectCode: "2026-001",
        project: `Bridge upgrade${PATH_SEPARATOR}Design${PATH_SEPARATOR}Pier design`,
        hours: 2.5,
        note: "Load combinations",
        tags: "",
      },
      {
        date: "2026-09-29",
        person: "Aisha Patel",
        email: "aisha@example.com",
        client: "Acme Engineering",
        projectCode: "2026-001",
        project: `Bridge upgrade${PATH_SEPARATOR}Design${PATH_SEPARATOR}Pier design`,
        hours: 6,
        note: "",
        tags: "",
      },
    ],
  };
  const howTo: ExportTable = {
    title: "How to use",
    columns: [text("line", "How to use this workbook", 100)],
    rows: [
      {
        line: "Projects: one row per project or item. Path is the names from the project down, separated by › (or >).",
      },
      {
        line: "Project code is the project's own code and is repeated on every row of that project. Item code is optional.",
      },
      {
        line: "Type is your own label (Phase, Task, …). Put Yes under Done for finished items. Budget hours is optional.",
      },
      {
        line: "Hours: one row per entry. Person (or Email) must match someone in Stint. Hours can be 1.5, 1:30 or 90m.",
      },
      {
        line: "Date can be a real Excel date or YYYY-MM-DD. Rows already in Stint are skipped when you import again.",
      },
      { line: "Delete the example rows, fill in yours, then use Settings → Import / Export → Import." },
    ],
  };
  return toXlsx([
    { name: "Projects", table: projects },
    { name: "Hours", table: hours },
    { name: "How to use", table: howTo },
  ]);
}

export interface WorkbookParts {
  projectsCsv: string | null;
  hoursCsv: string | null;
  /** Sheets that were neither (ignored). */
  ignored: string[];
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Finds the Projects and Hours sheets of a workbook by their column headings (so renamed sheets
 * work too) and hands them on as CSV text for the importers. Numeric hours become H:MM:SS, so
 * "14" can't be mistaken for 14 minutes.
 */
export function readWorkbookParts(bytes: Uint8Array): WorkbookParts {
  const parts: WorkbookParts = { projectsCsv: null, hoursCsv: null, ignored: [] };
  for (const sheet of readXlsx(bytes)) {
    const first = sheet.rows.findIndex((r) => r.some((c) => c.trim() !== ""));
    if (first < 0) {
      parts.ignored.push(sheet.name);
      continue;
    }
    const rows = sheet.rows.slice(first);
    const headers = rows[0]!.map(norm);
    const has = (...names: string[]) => names.some((n) => headers.includes(n));
    if (has("project code", "code") && has("path") && !has("hours", "duration") && !parts.projectsCsv) {
      parts.projectsCsv = rowsToCsv(rows);
    } else if (has("date", "start date") && has("hours", "duration") && !parts.hoursCsv) {
      const hoursCol = headers.findIndex((h) => h === "hours" || h === "duration");
      const fixed = rows.map((r, i) =>
        i === 0 || !/^\d+(\.\d+)?$/.test(r[hoursCol] ?? "")
          ? r
          : r.map((c, j) => {
              if (j !== hoursCol) return c;
              const total = Math.round(Number(c) * 3600);
              return `${Math.floor(total / 3600)}:${String(Math.floor((total % 3600) / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
            }),
      );
      parts.hoursCsv = rowsToCsv(fixed);
    } else parts.ignored.push(sheet.name);
  }
  return parts;
}
