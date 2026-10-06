import type { Database } from "bun:sqlite";
import type {
  AccessContext,
  Actor,
  Client,
  Favorite,
  Project,
  ProjectMember,
  TimeEntry,
  Timesheet,
  User,
} from "@stint/shared";
import { currentSeq, fromDb, type Row, TABLES, type TableName } from "../db/tables.ts";
import { getMeta } from "../lib/meta.ts";
import { accessContext } from "./access.ts";
import { allProjects } from "./catalog.ts";
import { getOrganization } from "./org.ts";
import { entryVisible, favoriteVisible, memberVisible, projectVisible, timesheetVisible } from "./shape.ts";

/** Tables delivered by sync, in dependency order. */
export const SYNC_TABLES: TableName[] = [
  "users",
  "clients",
  "projects",
  "projectMembers",
  "tags",
  "timesheets",
  "timeEntries",
  "favorites",
];

export interface PullResult {
  changes: Partial<Record<TableName, Row[]>>;
  organization: ReturnType<typeof getOrganization> | null;
  cursor: number;
  hasMore: boolean;
  epoch: string;
  serverTime: number;
}

export function syncEpoch(db: Database, userId: string): string {
  const global = getMeta(db, "sync_epoch") ?? "0";
  const user =
    db.query<{ sync_epoch: number }, [string]>("SELECT sync_epoch FROM users WHERE id = ?").get(userId)
      ?.sync_epoch ?? 0;
  return `${global}.${user}`;
}

type Filter = (
  row: Row,
  actor: Actor,
  access: AccessContext,
  ctx: { visibleClientIds: Set<string> },
) => Row | null;

const FILTERS: Record<TableName, Filter> = {
  users: (r, actor) => {
    const u = r as unknown as User;
    if (actor.role === "member" && u.id !== actor.id) return null;
    return u as unknown as Row;
  },
  clients: (r, actor, _a, { visibleClientIds }) => {
    const c = r as unknown as Client;
    if (actor.role === "member" && !visibleClientIds.has(c.id)) return null;
    return c as unknown as Row;
  },
  projects: (r, actor, access) => {
    const p = r as unknown as Project;
    // Tombstones are always delivered so clients can drop the row.
    if (!p.deletedAt && !projectVisible(p, actor, access)) return null;
    return p as unknown as Row;
  },
  projectMembers: (r, actor, access) => {
    const m = r as unknown as ProjectMember;
    return memberVisible(m, actor, access) ? (m as unknown as Row) : null;
  },
  tags: (r) => r,
  timesheets: (r, actor, access) => (timesheetVisible(r as unknown as Timesheet, actor, access) ? r : null),
  timeEntries: (r, actor, access) => {
    const e = r as unknown as TimeEntry;
    return entryVisible(e, actor, access) ? (e as unknown as Row) : null;
  },
  favorites: (r, actor) => (favoriteVisible(r as unknown as Favorite, actor) ? r : null),
};

/**
 * Incremental pull: rows changed after `since` that this user may see, shaped
 * for their role. The cursor only advances past rows that were examined, so
 * paging never skips changes.
 */
export function pull(db: Database, actor: Actor, since: number, limit: number, now: number): PullResult {
  const access = accessContext(db, actor);
  const visibleClientIds = new Set(
    allProjects(db)
      .filter((p) => projectVisible(p, actor, access))
      .map((p) => p.clientId),
  );

  const candidates: { table: TableName; seq: number; raw: Record<string, unknown> }[] = [];
  for (const table of SYNC_TABLES) {
    const spec = TABLES[table];
    const rows = db
      .query<Record<string, unknown>, [number, number]>(
        `SELECT * FROM ${spec.table} WHERE server_seq > ? ORDER BY server_seq LIMIT ?`,
      )
      .all(since, limit + 1);
    for (const raw of rows) candidates.push({ table, seq: raw.server_seq as number, raw });
  }
  candidates.sort((a, b) => a.seq - b.seq);
  const page = candidates.slice(0, limit);
  const hasMore = candidates.length > limit;
  const cursor = hasMore ? page[page.length - 1]!.seq : Math.max(since, currentSeq(db));

  const changes: Partial<Record<TableName, Row[]>> = {};
  for (const c of page) {
    const shaped = FILTERS[c.table](fromDb(TABLES[c.table], c.raw), actor, access, { visibleClientIds });
    if (!shaped) continue;
    const list = changes[c.table];
    if (list) list.push(shaped);
    else changes[c.table] = [shaped];
  }

  const org = getOrganization(db);
  return {
    changes,
    organization: org && org.serverSeq > since ? org : null,
    cursor,
    hasMore,
    epoch: syncEpoch(db, actor.id),
    serverTime: now,
  };
}
