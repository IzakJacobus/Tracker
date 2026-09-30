import type { Database } from "bun:sqlite";

/**
 * Column specs for every synced table: maps the camelCase wire format to
 * snake_case SQLite columns and converts booleans / JSON.
 */
export type ColumnKind = "text" | "int" | "real" | "bool" | "json";

export interface TableSpec {
  table: string;
  /** camelCase field → [snake_case column, kind] */
  columns: Record<string, [string, ColumnKind]>;
}

const meta = {
  id: ["id", "text"],
  createdAt: ["created_at", "int"],
  updatedAt: ["updated_at", "int"],
  deletedAt: ["deleted_at", "int"],
  serverSeq: ["server_seq", "int"],
} satisfies Record<string, [string, ColumnKind]>;

function spec(table: string, columns: Record<string, [string, ColumnKind]>): TableSpec {
  return { table, columns: { ...meta, ...columns } };
}

export const TABLES = {
  users: spec("users", {
    email: ["email", "text"],
    name: ["name", "text"],
    role: ["role", "text"],
    rate: ["rate", "int"],
    weeklyCapacityMinutes: ["weekly_capacity_minutes", "int"],
    color: ["color", "text"],
    active: ["active", "bool"],
    mustChangePassword: ["must_change_password", "bool"],
    managerId: ["manager_id", "text"],
  }),
  clients: spec("clients", {
    name: ["name", "text"],
    code: ["code", "text"],
    rate: ["rate", "int"],
    isInternal: ["is_internal", "bool"],
    notes: ["notes", "text"],
    archivedAt: ["archived_at", "int"],
  }),
  projects: spec("projects", {
    clientId: ["client_id", "text"],
    parentId: ["parent_id", "text"],
    name: ["name", "text"],
    code: ["code", "text"],
    color: ["color", "text"],
    billableDefault: ["billable_default", "bool"],
    rate: ["rate", "int"],
    budgetMinutes: ["budget_minutes", "int"],
    budgetAmount: ["budget_amount", "int"],
    visibility: ["visibility", "text"],
    notes: ["notes", "text"],
    sortOrder: ["sort_order", "real"],
    archivedAt: ["archived_at", "int"],
  }),
  projectMembers: spec("project_members", {
    projectId: ["project_id", "text"],
    userId: ["user_id", "text"],
    role: ["role", "text"],
    rate: ["rate", "int"],
  }),
  tasks: spec("tasks", {
    projectId: ["project_id", "text"],
    name: ["name", "text"],
    rate: ["rate", "int"],
    billable: ["billable", "bool"],
    sortOrder: ["sort_order", "real"],
    archivedAt: ["archived_at", "int"],
  }),
  tags: spec("tags", {
    name: ["name", "text"],
    color: ["color", "text"],
    archivedAt: ["archived_at", "int"],
  }),
  timeEntries: spec("time_entries", {
    userId: ["user_id", "text"],
    projectId: ["project_id", "text"],
    taskId: ["task_id", "text"],
    description: ["description", "text"],
    startedAt: ["started_at", "int"],
    durationS: ["duration_s", "int"],
    entryDate: ["entry_date", "text"],
    billable: ["billable", "bool"],
    rateSnapshot: ["rate_snapshot", "int"],
    currency: ["currency", "text"],
    source: ["source", "text"],
    tagIds: ["tag_ids", "json"],
  }),
  timesheets: spec("timesheets", {
    userId: ["user_id", "text"],
    periodStart: ["period_start", "text"],
    periodEnd: ["period_end", "text"],
    status: ["status", "text"],
    submittedAt: ["submitted_at", "int"],
    decidedBy: ["decided_by", "text"],
    decidedAt: ["decided_at", "int"],
    comment: ["comment", "text"],
  }),
  favorites: spec("favorites", {
    userId: ["user_id", "text"],
    projectId: ["project_id", "text"],
    taskId: ["task_id", "text"],
    sortOrder: ["sort_order", "real"],
  }),
} as const;

export type TableName = keyof typeof TABLES;
export type Row = Record<string, unknown>;
type SqlValue = string | number | null;

export function fromDb(spec: TableSpec, raw: Record<string, unknown>): Row {
  const out: Row = {};
  for (const [field, [col, kind]] of Object.entries(spec.columns)) {
    const v = raw[col];
    if (v === null || v === undefined) {
      out[field] = null;
    } else if (kind === "bool") {
      out[field] = v === 1 || v === true;
    } else if (kind === "json") {
      out[field] = JSON.parse(String(v));
    } else {
      out[field] = v;
    }
  }
  return out;
}

function toDbValue(kind: ColumnKind, v: unknown): SqlValue {
  if (v === null || v === undefined) return null;
  if (kind === "bool") return v ? 1 : 0;
  if (kind === "json") return JSON.stringify(v);
  return v as SqlValue;
}

/** Global change sequence: strictly increasing across all synced tables. */
export function nextSeq(db: Database): number {
  const row = db
    .query<{ seq: number }, []>("UPDATE sync_counter SET seq = seq + 1 WHERE id = 1 RETURNING seq")
    .get();
  return row!.seq;
}

export function currentSeq(db: Database): number {
  return db.query<{ seq: number }, []>("SELECT seq FROM sync_counter WHERE id = 1").get()!.seq;
}

export function getRow(db: Database, spec: TableSpec, id: string): Row | null {
  const raw = db.query<Record<string, unknown>, [string]>(`SELECT * FROM ${spec.table} WHERE id = ?`).get(id);
  return raw ? fromDb(spec, raw) : null;
}

export function getFieldClock(db: Database, spec: TableSpec, id: string): Record<string, string> {
  const raw = db
    .query<{ field_clock: string }, [string]>(`SELECT field_clock FROM ${spec.table} WHERE id = ?`)
    .get(id);
  return raw ? (JSON.parse(raw.field_clock) as Record<string, string>) : {};
}

export function listRows(db: Database, spec: TableSpec, where = "1=1", params: SqlValue[] = []): Row[] {
  return db
    .query<Record<string, unknown>, SqlValue[]>(`SELECT * FROM ${spec.table} WHERE ${where}`)
    .all(...params)
    .map((r) => fromDb(spec, r));
}

/** Inserts a row, assigning server_seq. Unknown fields are ignored. */
export function insertRow(
  db: Database,
  spec: TableSpec,
  row: Row,
  fieldClock: Record<string, string> = {},
): Row {
  const seq = nextSeq(db);
  const data: Row = { ...row, serverSeq: seq };
  const cols: string[] = [];
  const vals: SqlValue[] = [];
  for (const [field, [col, kind]] of Object.entries(spec.columns)) {
    if (field in data) {
      cols.push(col);
      vals.push(toDbValue(kind, data[field]));
    }
  }
  cols.push("field_clock");
  vals.push(JSON.stringify(fieldClock));
  db.query(`INSERT INTO ${spec.table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(
    ...vals,
  );
  return getRow(db, spec, String(row.id))!;
}

/** Updates the given fields, bumping updated_at and server_seq. */
export function updateRow(
  db: Database,
  spec: TableSpec,
  id: string,
  patch: Row,
  now: number,
  fieldClock?: Record<string, string>,
): Row {
  const seq = nextSeq(db);
  const sets: string[] = [];
  const vals: SqlValue[] = [];
  for (const [field, value] of Object.entries({ ...patch, updatedAt: now, serverSeq: seq })) {
    const c = spec.columns[field];
    if (!c || field === "id" || field === "createdAt") continue;
    sets.push(`${c[0]} = ?`);
    vals.push(toDbValue(c[1], value));
  }
  if (fieldClock) {
    sets.push("field_clock = ?");
    vals.push(JSON.stringify(fieldClock));
  }
  db.query(`UPDATE ${spec.table} SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
  return getRow(db, spec, id)!;
}
