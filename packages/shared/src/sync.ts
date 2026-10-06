import { compareHlc } from "./hlc.ts";
import { MAX_ENTRY_SECONDS } from "./schemas.ts";

/**
 * The sync merge engine: a pure function deciding what an incoming change does
 * to a stored row. The rules (tested in test/sync-merge.test.ts):
 *
 *  - field-level last-write-wins by HLC; untouched fields are left alone
 *  - deletes are tombstones and win — sync never revives a deleted row
 *  - locked rows (submitted/approved periods) reject every change, before and after
 *  - only whitelisted fields are writable; the rest are stripped
 */
export type WritableSyncTable = "timeEntries" | "favorites" | "tags";

export interface IncomingChange {
  changeId: string;
  table: WritableSyncTable;
  id: string;
  op: "create" | "update" | "delete";
  patch: Record<string, unknown>;
  hlc: string;
}

export interface StoredRow {
  row: Record<string, unknown> & { id: string; deletedAt: number | null };
  fieldClock: Record<string, string>;
}

export type MergeResult =
  | {
      kind: "insert";
      row: Record<string, unknown>;
      fieldClock: Record<string, string>;
      strippedFields: string[];
    }
  | {
      kind: "update";
      patch: Record<string, unknown>;
      fieldClock: Record<string, string>;
      ignoredFields: string[];
      strippedFields: string[];
    }
  | { kind: "noop"; reason: "stale" | "deleted" }
  | { kind: "reject"; code: "not_found" | "locked"; message: string };

export interface MergeInput {
  existing: StoredRow | null;
  change: IncomingChange;
  writableFields: readonly string[];
  /** true if a row (as it is, or as it would become) falls in a locked period */
  isLocked?: (row: Record<string, unknown>) => boolean;
  /** recomputes server-derived fields (e.g. entryDate) for the lock check */
  derive?: (row: Record<string, unknown>) => Record<string, unknown>;
  now?: number;
}

const LOCKED_MESSAGE = "This time is in a submitted or approved timesheet and can't be changed.";

export function mergeChange(input: MergeInput): MergeResult {
  const { existing, change, writableFields } = input;
  const derive = input.derive ?? ((r) => r);
  const isLocked = input.isLocked ?? (() => false);
  const allowed = new Set(writableFields);
  const strippedFields: string[] = [];
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(change.patch)) {
    if (allowed.has(k)) clean[k] = v;
    else if (k !== "id") strippedFields.push(k);
  }

  // ---- delete ------------------------------------------------------
  if (change.op === "delete") {
    if (!existing || existing.row.deletedAt) return { kind: "noop", reason: "deleted" };
    if (isLocked(derive(existing.row))) return { kind: "reject", code: "locked", message: LOCKED_MESSAGE };
    return {
      kind: "update",
      patch: { deletedAt: input.now ?? Date.now() },
      fieldClock: { ...existing.fieldClock, deletedAt: change.hlc },
      ignoredFields: [],
      strippedFields,
    };
  }

  // ---- create (new row) --------------------------------------------
  if (!existing) {
    if (change.op === "update") {
      return { kind: "reject", code: "not_found", message: "This item no longer exists on the server." };
    }
    const row = derive({ ...clean, id: change.id, deletedAt: null });
    if (isLocked(row)) return { kind: "reject", code: "locked", message: LOCKED_MESSAGE };
    const fieldClock: Record<string, string> = {};
    for (const k of Object.keys(clean)) fieldClock[k] = change.hlc;
    return { kind: "insert", row: { ...clean, id: change.id, deletedAt: null }, fieldClock, strippedFields };
  }

  // ---- update (or a retried create) ---------------------------------
  if (existing.row.deletedAt) return { kind: "noop", reason: "deleted" };
  if (isLocked(derive(existing.row))) return { kind: "reject", code: "locked", message: LOCKED_MESSAGE };

  const patch: Record<string, unknown> = {};
  const ignoredFields: string[] = [];
  const fieldClock = { ...existing.fieldClock };
  for (const [k, v] of Object.entries(clean)) {
    const current = existing.fieldClock[k];
    if (current === undefined || compareHlc(change.hlc, current) > 0) {
      patch[k] = v;
      fieldClock[k] = change.hlc;
    } else {
      ignoredFields.push(k);
    }
  }
  if (Object.keys(patch).length === 0) return { kind: "noop", reason: "stale" };
  if (isLocked(derive({ ...existing.row, ...patch })))
    return { kind: "reject", code: "locked", message: LOCKED_MESSAGE };
  return { kind: "update", patch, fieldClock, ignoredFields, strippedFields };
}

/**
 * One running timer per person. Given all of a person's running/finished
 * entries, returns the updates that stop every running timer except the newest,
 * each at the moment the next one started.
 */
export function resolveRunningTimers(
  entries: readonly { id: string; startedAt: number; durationS: number | null }[],
): { id: string; durationS: number }[] {
  const running = entries.filter((e) => e.durationS === null).sort((a, b) => a.startedAt - b.startedAt);
  const out: { id: string; durationS: number }[] = [];
  for (let i = 0; i < running.length - 1; i++) {
    const cur = running[i]!;
    const next = running[i + 1]!;
    const seconds = Math.round((next.startedAt - cur.startedAt) / 1000);
    out.push({ id: cur.id, durationS: Math.max(0, Math.min(MAX_ENTRY_SECONDS, seconds)) });
  }
  return out;
}

/** Fields each synced table accepts from clients. Everything else is server-owned. */
export const SYNC_WRITABLE_FIELDS: Record<WritableSyncTable, readonly string[]> = {
  timeEntries: ["projectId", "taskId", "description", "startedAt", "durationS", "tagIds", "source"],
  favorites: ["projectId", "taskId", "sortOrder"],
  tags: ["name", "color"],
};
