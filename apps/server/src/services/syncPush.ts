import type { Database } from "bun:sqlite";
import {
  type AccessContext,
  type Actor,
  canEditEntry,
  canManageTags,
  canTrackOnProject,
  clampHlc,
  Id,
  type IncomingChange,
  localDate,
  MAX_ENTRY_SECONDS,
  mergeChange,
  type OrgSettings,
  resolveBillable,
  resolveRate,
  SYNC_WRITABLE_FIELDS,
  type TimeEntry,
  type WritableSyncTable,
} from "@stint/shared";
import { z } from "zod";
import { getFieldClock, getRow, insertRow, type Row, TABLES, updateRow } from "../db/tables.ts";
import { audit } from "../lib/audit.ts";
import type { Logger } from "../lib/log.ts";
import { accessContext } from "./access.ts";
import { allProjects, ancestorsNearestFirst, getClient, getProject, getTask } from "./catalog.ts";
import { getOrgSettings } from "./org.ts";
import { entryVisible, shapeEntry } from "./shape.ts";
import { getUser } from "./users.ts";

export const PushChange = z.object({
  changeId: z.string().min(1).max(64),
  table: z.enum(["timeEntries", "favorites", "tags"]),
  id: Id,
  op: z.enum(["create", "update", "delete"]),
  patch: z.record(z.string(), z.unknown()).default({}),
  hlc: z.string().regex(/^\d{15}:\d{5}:[A-Za-z0-9_-]{1,40}$/),
});
export const PushBody = z.object({ changes: z.array(PushChange).max(500) });

export type PushStatus = "accepted" | "merged" | "noop" | "rejected";
export interface PushResult {
  changeId: string;
  table: WritableSyncTable;
  id: string;
  status: PushStatus;
  code?: string;
  message?: string;
  /** the authoritative row after the change (shaped for the caller), or null if it doesn't exist */
  row: Row | null;
}

class Reject extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface PushCtx {
  db: Database;
  actor: Actor;
  access: AccessContext;
  settings: OrgSettings;
  now: number;
  ip: string;
}

/* ---------------- locks ---------------- */

export function isPeriodLocked(db: Database, userId: string, date: string): boolean {
  return (
    db
      .query<{ n: number }, [string, string, string]>(
        "SELECT COUNT(*) AS n FROM timesheets WHERE user_id = ? AND period_start <= ? AND period_end >= ? AND status IN ('submitted', 'approved') AND deleted_at IS NULL",
      )
      .get(userId, date, date)!.n > 0
  );
}

/* ---------------- rates ---------------- */

export function snapshotRate(
  db: Database,
  entry: { userId: string; projectId: string; taskId: string | null },
  settings: OrgSettings,
): number {
  const project = getProject(db, entry.projectId);
  const user = getUser(db, entry.userId);
  const chain = project ? [project, ...ancestorsNearestFirst(db, project.id)] : [];
  const memberRates = new Map<string, number | null>(
    db
      .query<{ project_id: string; rate: number | null }, [string]>(
        "SELECT project_id, rate FROM project_members WHERE user_id = ? AND deleted_at IS NULL",
      )
      .all(entry.userId)
      .map((m) => [m.project_id, m.rate]),
  );
  const task = entry.taskId ? getTask(db, entry.taskId) : null;
  const client = project ? getClient(db, project.clientId) : null;
  return resolveRate({
    organizationDefault: settings.defaultRate,
    user: { id: entry.userId, rate: user?.rate ?? null },
    client: client ? { id: client.id, rate: client.rate } : null,
    projectChain: chain.map((p) => ({ id: p.id, rate: p.rate })),
    memberRates,
    task: task ? { id: task.id, rate: task.rate } : null,
  }).rate;
}

/* ---------------- validation ---------------- */

const MIN_TIME = Date.UTC(2000, 0, 1);
const MAX_TIME = Date.UTC(2100, 0, 1);

function validateEntry(p: PushCtx, e: TimeEntry): void {
  if (typeof e.projectId !== "string") throw new Reject("invalid", "Choose a project.");
  const project = getProject(p.db, e.projectId);
  if (!project || project.deletedAt) throw new Reject("invalid", "That project no longer exists.");
  const owner = { id: e.userId, role: getUser(p.db, e.userId)?.role ?? "member" } as Actor;
  const ownerAccess = owner.id === p.actor.id ? p.access : accessContext(p.db, owner);
  if (!canTrackOnProject(owner, e.projectId, ownerAccess)) {
    throw new Reject("forbidden", `You're not on the project “${project.name}”. Ask a manager to add you.`);
  }
  // Tasks became items in the project tree (0.2): time goes on the item itself.
  if (e.taskId !== null) throw new Reject("invalid", "Choose the item in the project instead of a task.");
  if (
    typeof e.startedAt !== "number" ||
    !Number.isFinite(e.startedAt) ||
    e.startedAt < MIN_TIME ||
    e.startedAt > MAX_TIME
  ) {
    throw new Reject("invalid", "The start time isn't valid.");
  }
  if (e.durationS === null) throw new Reject("invalid", "Enter the hours.");
  if (!Number.isInteger(e.durationS) || e.durationS < 0 || e.durationS > MAX_ENTRY_SECONDS) {
    throw new Reject("invalid", "An entry can be at most 24 hours long.");
  }
  if (typeof e.description !== "string" || e.description.length > 2000)
    throw new Reject("invalid", "The description is too long.");
  if (typeof e.billable !== "boolean") throw new Reject("invalid", "Billable must be yes or no.");
  if (!Array.isArray(e.tagIds) || e.tagIds.length > 20 || e.tagIds.some((t) => typeof t !== "string")) {
    throw new Reject("invalid", "Invalid tags.");
  }
  if (!["timer", "manual", "grid", "import"].includes(e.source))
    throw new Reject("invalid", "Invalid source.");
}

/**
 * Hours go on an item with nothing under it, which isn't done (archived), and isn't under a done
 * item. Only checked when the item is newly chosen, so older entries stay editable.
 */
function checkLoggable(p: PushCtx, projectId: string): void {
  const all = allProjects(p.db);
  const item = all.find((x) => x.id === projectId);
  if (!item) return; // validateEntry reports a missing project
  // Done first: it's the reason that matters to the person, even if the item also has items under it.
  const byId = new Map(all.map((x) => [x.id, x]));
  for (
    let cur: typeof item | undefined = item;
    cur;
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  ) {
    if (cur.archivedAt) {
      throw new Reject(
        "invalid",
        cur.parentId
          ? `“${cur.name}” is marked done, so it can't take new hours.`
          : `“${cur.name}” is archived, so it can't take new hours.`,
      );
    }
  }
  if (all.some((x) => x.parentId === projectId && !x.deletedAt)) {
    throw new Reject("invalid", `Choose an item under “${item.name}”: hours go on the lowest level.`);
  }
}

/**
 * Tags must be listed once each, and newly added ones must exist. Tags already on the
 * entry are left alone, so an entry whose tag was deleted later can still be edited.
 */
function checkEntryTags(p: PushCtx, tagIds: string[], previous: readonly string[]): void {
  if (new Set(tagIds).size !== tagIds.length) throw new Reject("invalid", "A tag is listed twice.");
  for (const id of tagIds) {
    if (previous.includes(id)) continue;
    const tag = getRow(p.db, TABLES.tags, id) as { deletedAt: number | null } | null;
    if (!tag || tag.deletedAt) throw new Reject("invalid", "That tag no longer exists.");
  }
}

/* ---------------- per-table handlers ---------------- */

function pushEntry(p: PushCtx, c: IncomingChange): PushResult {
  const spec = TABLES.timeEntries;
  const before = getRow(p.db, spec, c.id) as TimeEntry | null;
  if (before && !canEditEntry(p.actor, before))
    throw new Reject("forbidden", "You can only change your own time.");
  const ownerId = before?.userId ?? p.actor.id;
  const derive = (row: Record<string, unknown>) => ({
    ...row,
    userId: ownerId,
    entryDate:
      typeof row.startedAt === "number" ? localDate(row.startedAt, p.settings.timezone) : row.entryDate,
  });
  const result = mergeChange({
    existing: before
      ? {
          row: before as unknown as Row & { id: string; deletedAt: number | null },
          fieldClock: getFieldClock(p.db, spec, c.id),
        }
      : null,
    change: c,
    writableFields: SYNC_WRITABLE_FIELDS.timeEntries,
    isLocked: (row) => typeof row.entryDate === "string" && isPeriodLocked(p.db, ownerId, row.entryDate),
    derive,
    now: p.now,
  });

  if (result.kind === "reject") throw new Reject(result.code, result.message);
  if (result.kind === "noop") return done(p, c, "noop", result.reason === "deleted" ? "deleted" : undefined);

  if (result.kind === "insert") {
    const r = result.row as Partial<TimeEntry>;
    const project = typeof r.projectId === "string" ? getProject(p.db, r.projectId) : null;
    const task = typeof r.taskId === "string" ? getTask(p.db, r.taskId) : null;
    const entry: TimeEntry = {
      id: c.id,
      userId: ownerId,
      projectId: r.projectId as string,
      taskId: (r.taskId as string | null | undefined) ?? null,
      description: r.description ?? "",
      startedAt: r.startedAt as number,
      durationS: r.durationS === undefined ? null : r.durationS,
      entryDate: typeof r.startedAt === "number" ? localDate(r.startedAt, p.settings.timezone) : "",
      billable: r.billable ?? (project ? resolveBillable(task, project) : true),
      rateSnapshot: null,
      currency: p.settings.currency,
      source: r.source ?? "manual",
      tagIds: r.tagIds ?? [],
      createdAt: p.now,
      updatedAt: p.now,
      deletedAt: null,
      serverSeq: 0,
    };
    validateEntry(p, entry);
    checkLoggable(p, entry.projectId);
    checkEntryTags(p, entry.tagIds, []);
    entry.rateSnapshot = snapshotRate(p.db, entry, p.settings);
    const inserted = insertRow(p.db, spec, entry as unknown as Row, result.fieldClock);
    audit(p.db, p.now, {
      actorId: p.actor.id,
      action: "create",
      entity: "time_entry",
      entityId: c.id,
      after: inserted,
      ip: p.ip,
    });
    return done(p, c, "accepted");
  }

  // update / delete
  const next = { ...before!, ...result.patch } as TimeEntry;
  if (!result.patch.deletedAt) {
    next.entryDate = localDate(next.startedAt, p.settings.timezone);
    validateEntry(p, next);
    if ("projectId" in result.patch && result.patch.projectId !== before!.projectId)
      checkLoggable(p, next.projectId);
    if ("tagIds" in result.patch) checkEntryTags(p, next.tagIds, before!.tagIds);
  }
  const derived: Record<string, unknown> = { ...result.patch };
  if (!result.patch.deletedAt) {
    derived.entryDate = next.entryDate;
    if ("projectId" in result.patch || "taskId" in result.patch) {
      derived.rateSnapshot = snapshotRate(p.db, next, p.settings);
      derived.currency = p.settings.currency;
    }
  }
  const after = updateRow(p.db, spec, c.id, derived, p.now, result.fieldClock);
  audit(p.db, p.now, {
    actorId: p.actor.id,
    action: result.patch.deletedAt ? "delete" : "update",
    entity: "time_entry",
    entityId: c.id,
    before,
    after,
    ip: p.ip,
  });
  return done(p, c, result.ignoredFields.length ? "merged" : "accepted");
}

function pushFavorite(p: PushCtx, c: IncomingChange): PushResult {
  const spec = TABLES.favorites;
  const before = getRow(p.db, spec, c.id) as { userId: string; deletedAt: number | null } | null;
  if (before && before.userId !== p.actor.id) throw new Reject("forbidden", "Not your favourite.");
  const result = mergeChange({
    existing: before
      ? {
          row: before as unknown as Row & { id: string; deletedAt: number | null },
          fieldClock: getFieldClock(p.db, spec, c.id),
        }
      : null,
    change: c,
    writableFields: SYNC_WRITABLE_FIELDS.favorites,
    now: p.now,
  });
  if (result.kind === "reject") throw new Reject(result.code, result.message);
  if (result.kind === "noop") return done(p, c, "noop");
  if (result.kind === "insert") {
    const { projectId, taskId } = checkFavorite(p, result.row);
    insertRow(
      p.db,
      spec,
      {
        id: c.id,
        userId: p.actor.id,
        projectId,
        taskId,
        sortOrder: typeof result.row.sortOrder === "number" ? result.row.sortOrder : 0,
        createdAt: p.now,
        updatedAt: p.now,
        deletedAt: null,
      },
      result.fieldClock,
    );
    return done(p, c, "accepted");
  }
  // Updates get the same checks as creates (a favourite can't be repointed somewhere off-limits).
  if (!("deletedAt" in result.patch)) {
    const merged = { ...(before as unknown as Row), ...result.patch };
    checkFavorite(p, merged);
    if ("sortOrder" in result.patch && !Number.isFinite(result.patch.sortOrder)) {
      throw new Reject("invalid", "Invalid favourite order.");
    }
  }
  updateRow(p.db, spec, c.id, result.patch, p.now, result.fieldClock);
  return done(p, c, result.ignoredFields.length ? "merged" : "accepted");
}

/** A favourite must point at a project item the person can track on (tasks are items since 0.2). */
function checkFavorite(p: PushCtx, row: Row): { projectId: string; taskId: null } {
  const projectId = row.projectId;
  if (typeof projectId !== "string" || !canTrackOnProject(p.actor, projectId, p.access)) {
    throw new Reject("forbidden", "You can't track time on that project.");
  }
  if (row.taskId !== null && row.taskId !== undefined)
    throw new Reject("invalid", "Choose the item in the project instead of a task.");
  return { projectId, taskId: null };
}

/** Tag names are trimmed, at most 60 characters and unique (ignoring case); colours are #rrggbb. */
function checkTagName(p: PushCtx, raw: unknown, selfId: string): string {
  const name = typeof raw === "string" ? raw.trim().slice(0, 60) : "";
  if (!name) throw new Reject("invalid", "A tag needs a name.");
  const dup = p.db
    .query<{ id: string }, [string, string]>(
      "SELECT id FROM tags WHERE name = ? COLLATE NOCASE AND deleted_at IS NULL AND id <> ?",
    )
    .get(name, selfId);
  if (dup) throw new Reject("duplicate", `A tag called “${name}” already exists.`);
  return name;
}

function checkTagColor(raw: unknown): string {
  if (typeof raw !== "string" || !/^#[0-9a-f]{6}$/i.test(raw))
    throw new Reject("invalid", "Invalid tag colour.");
  return raw;
}

function pushTag(p: PushCtx, c: IncomingChange): PushResult {
  const spec = TABLES.tags;
  const before = getRow(p.db, spec, c.id) as { deletedAt: number | null } | null;
  if (before && !canManageTags(p.actor))
    throw new Reject("forbidden", "Only managers can change existing tags.");
  const result = mergeChange({
    existing: before
      ? {
          row: before as unknown as Row & { id: string; deletedAt: number | null },
          fieldClock: getFieldClock(p.db, spec, c.id),
        }
      : null,
    change: c,
    writableFields: SYNC_WRITABLE_FIELDS.tags,
    now: p.now,
  });
  if (result.kind === "reject") throw new Reject(result.code, result.message);
  if (result.kind === "noop") return done(p, c, "noop");
  if (result.kind === "insert") {
    const name = checkTagName(p, result.row.name, c.id);
    const color = result.row.color === undefined ? "#6b7280" : checkTagColor(result.row.color);
    insertRow(
      p.db,
      spec,
      { id: c.id, name, color, archivedAt: null, createdAt: p.now, updatedAt: p.now, deletedAt: null },
      result.fieldClock,
    );
    audit(p.db, p.now, { actorId: p.actor.id, action: "create", entity: "tag", entityId: c.id, ip: p.ip });
    return done(p, c, "accepted");
  }
  const patch = { ...result.patch };
  if ("name" in patch) patch.name = checkTagName(p, patch.name, c.id);
  if ("color" in patch) patch.color = checkTagColor(patch.color);
  updateRow(p.db, spec, c.id, patch, p.now, result.fieldClock);
  return done(p, c, result.ignoredFields.length ? "merged" : "accepted");
}

/**
 * The server's copy of the row, so the device can correct itself. Only rows the actor could
 * also get through pull are returned (a rejected change must not reveal someone else's data);
 * otherwise null, which makes the device drop its local copy.
 */
function currentRow(p: PushCtx, table: WritableSyncTable, id: string): Row | null {
  const row = getRow(p.db, TABLES[table], id);
  if (!row) return null;
  if (table === "timeEntries") {
    const e = row as unknown as TimeEntry;
    return entryVisible(e, p.actor, p.access) ? (shapeEntry(e, p.actor, p.access) as unknown as Row) : null;
  }
  if (table === "favorites") return row.userId === p.actor.id ? row : null;
  return row;
}

function done(p: PushCtx, c: IncomingChange, status: PushStatus, code?: string): PushResult {
  return { changeId: c.changeId, table: c.table, id: c.id, status, code, row: currentRow(p, c.table, c.id) };
}

/**
 * Applies a batch of changes from one device. Each change is its own
 * transaction, so a rejected change never blocks the others.
 */
export function push(
  db: Database,
  actor: Actor,
  changes: IncomingChange[],
  now: number,
  ip: string,
  log?: Pick<Logger, "error">,
): PushResult[] {
  const p: PushCtx = { db, actor, access: accessContext(db, actor), settings: getOrgSettings(db), now, ip };
  const results: PushResult[] = [];
  for (const raw of changes) {
    const c = { ...raw, hlc: clampHlc(raw.hlc, now) };
    try {
      const r = db.transaction(() => {
        switch (c.table) {
          case "timeEntries":
            return pushEntry(p, c);
          case "favorites":
            return pushFavorite(p, c);
          case "tags":
            return pushTag(p, c);
        }
      })();
      results.push(r);
    } catch (e) {
      // An unexpected error (a bug, a database constraint) rejects only this change: the
      // ones before it are already saved, and the device must not resend the batch forever.
      const known = e instanceof Reject;
      if (!known) log?.error("Sync change failed", { table: c.table, id: c.id, error: String(e) });
      results.push({
        changeId: c.changeId,
        table: c.table,
        id: c.id,
        status: "rejected",
        code: known ? e.code : "error",
        message: known ? e.message : "The server couldn't save this change.",
        row: (() => {
          try {
            return currentRow(p, c.table, c.id);
          } catch {
            return null;
          }
        })(),
      });
    }
  }
  return results;
}
