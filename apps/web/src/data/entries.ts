import {
  type HlcClock,
  localDate,
  MAX_ENTRY_SECONDS,
  type Project,
  resolveBillable,
  SYNC_WRITABLE_FIELDS,
  type Task,
  type TimeEntry,
  uuidv7,
  zonedToInstant,
} from "@stint/shared";
import type { OutboxChange, StintDB, WritableTable } from "./db.ts";

export interface EntryDraft {
  projectId: string;
  taskId?: string | null;
  description?: string;
  startedAt: number;
  durationS: number | null;
  billable?: boolean;
  tagIds?: string[];
  source?: TimeEntry["source"];
}

export interface RepoContext {
  db: StintDB;
  clock: HlcClock;
  userId: string;
  timezone: string;
  currency: string;
  now?: () => number;
  /** called after every local write so the sync engine can push soon */
  onChange?: () => void;
}

function pickWritable(table: WritableTable, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of SYNC_WRITABLE_FIELDS[table]) if (k in row) out[k] = row[k];
  return out;
}

/**
 * All writes to time entries go through here: the local copy is updated
 * immediately (optimistic, works offline) and a change is queued for the server.
 */
export class EntryRepo {
  constructor(private readonly ctx: RepoContext) {}

  private now(): number {
    return this.ctx.now?.() ?? Date.now();
  }

  private async queue(
    table: WritableTable,
    id: string,
    op: OutboxChange["op"],
    patch: Record<string, unknown>,
  ) {
    await this.ctx.db.outbox.add({
      changeId: uuidv7(),
      table,
      id,
      op,
      patch,
      hlc: this.ctx.clock.now(),
      createdAt: this.now(),
      attempts: 0,
    });
  }

  private done() {
    this.ctx.onChange?.();
  }

  async billableFor(projectId: string, taskId: string | null): Promise<boolean> {
    const project = await this.ctx.db.projects.get(projectId);
    const task = taskId ? await this.ctx.db.tasks.get(taskId) : null;
    return project ? resolveBillable(task ?? null, project) : true;
  }

  async create(draft: EntryDraft): Promise<TimeEntry> {
    const now = this.now();
    const taskId = draft.taskId ?? null;
    const entry: TimeEntry = {
      id: uuidv7(now),
      userId: this.ctx.userId,
      projectId: draft.projectId,
      taskId,
      description: draft.description ?? "",
      startedAt: draft.startedAt,
      durationS: draft.durationS === null ? null : clampDuration(draft.durationS),
      entryDate: localDate(draft.startedAt, this.ctx.timezone),
      billable: draft.billable ?? (await this.billableFor(draft.projectId, taskId)),
      rateSnapshot: null,
      currency: this.ctx.currency,
      source: draft.source ?? "manual",
      tagIds: draft.tagIds ?? [],
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      serverSeq: 0,
    };
    await this.ctx.db.transaction("rw", [this.ctx.db.timeEntries, this.ctx.db.outbox], async () => {
      await this.ctx.db.timeEntries.put(entry);
      await this.queue(
        "timeEntries",
        entry.id,
        "create",
        pickWritable("timeEntries", entry as unknown as Record<string, unknown>),
      );
    });
    this.done();
    return entry;
  }

  async update(
    id: string,
    patch: Partial<
      Pick<
        TimeEntry,
        "projectId" | "taskId" | "description" | "startedAt" | "durationS" | "billable" | "tagIds"
      >
    >,
  ) {
    const clean = pickWritable("timeEntries", patch as Record<string, unknown>);
    if ("durationS" in clean && clean.durationS !== null)
      clean.durationS = clampDuration(clean.durationS as number);
    if (Object.keys(clean).length === 0) return;
    await this.ctx.db.transaction("rw", [this.ctx.db.timeEntries, this.ctx.db.outbox], async () => {
      const cur = await this.ctx.db.timeEntries.get(id);
      if (!cur) return;
      const local: Partial<TimeEntry> = { ...clean, updatedAt: this.now() };
      if (typeof clean.startedAt === "number")
        local.entryDate = localDate(clean.startedAt, this.ctx.timezone);
      await this.ctx.db.timeEntries.update(id, local);
      await this.queue("timeEntries", id, "update", clean);
    });
    this.done();
  }

  async remove(id: string): Promise<TimeEntry | undefined> {
    let removed: TimeEntry | undefined;
    await this.ctx.db.transaction("rw", [this.ctx.db.timeEntries, this.ctx.db.outbox], async () => {
      removed = await this.ctx.db.timeEntries.get(id);
      await this.ctx.db.timeEntries.delete(id);
      await this.queue("timeEntries", id, "delete", {});
    });
    this.done();
    return removed;
  }

  /** Restores a just-deleted entry (the toast's Undo) as a new entry. */
  async restore(entry: TimeEntry): Promise<TimeEntry> {
    return this.create({ ...entry, source: entry.source });
  }

  async running(): Promise<TimeEntry | undefined> {
    const mine = await this.ctx.db.timeEntries.where("userId").equals(this.ctx.userId).toArray();
    return mine.filter((e) => e.durationS === null).sort((a, b) => b.startedAt - a.startedAt)[0];
  }

  async stop(at = this.now()): Promise<TimeEntry | undefined> {
    const r = await this.running();
    if (!r) return undefined;
    const durationS = Math.max(0, Math.round((at - r.startedAt) / 1000));
    // Timers left running past 24 h are capped; the person can fix the entry afterwards.
    await this.update(r.id, { durationS: clampDuration(durationS) });
    return { ...r, durationS };
  }

  /** Starts a timer (stopping any running one first). */
  async start(
    draft: Omit<EntryDraft, "startedAt" | "durationS" | "source"> & { startedAt?: number },
  ): Promise<TimeEntry> {
    const at = draft.startedAt ?? this.now();
    await this.stop(at);
    return this.create({ ...draft, startedAt: at, durationS: null, source: "timer" });
  }

  async continueEntry(e: TimeEntry): Promise<TimeEntry> {
    return this.start({
      projectId: e.projectId,
      taskId: e.taskId,
      description: e.description,
      tagIds: e.tagIds,
      billable: e.billable,
    });
  }

  async duplicate(e: TimeEntry): Promise<TimeEntry> {
    return this.create({
      projectId: e.projectId,
      taskId: e.taskId,
      description: e.description,
      startedAt: e.durationS === null ? e.startedAt : e.startedAt + e.durationS * 1000,
      durationS: e.durationS ?? 0,
      billable: e.billable,
      tagIds: e.tagIds,
      source: "manual",
    });
  }

  /* favourites ------------------------------------------------------ */

  async toggleFavorite(projectId: string, taskId: string | null): Promise<boolean> {
    const favs = await this.ctx.db.favorites.where("userId").equals(this.ctx.userId).toArray();
    const existing = favs.find((f) => f.projectId === projectId && (f.taskId ?? null) === taskId);
    const now = this.now();
    await this.ctx.db.transaction("rw", [this.ctx.db.favorites, this.ctx.db.outbox], async () => {
      if (existing) {
        await this.ctx.db.favorites.delete(existing.id);
        await this.queue("favorites", existing.id, "delete", {});
      } else {
        const fav = {
          id: uuidv7(now),
          userId: this.ctx.userId,
          projectId,
          taskId,
          sortOrder: favs.length,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          serverSeq: 0,
        };
        await this.ctx.db.favorites.put(fav);
        await this.queue("favorites", fav.id, "create", { projectId, taskId, sortOrder: fav.sortOrder });
      }
    });
    this.done();
    return !existing;
  }

  /* tags ------------------------------------------------------------ */

  async createTag(name: string, color = "#6b7280") {
    const now = this.now();
    const tag = {
      id: uuidv7(now),
      name: name.trim(),
      color,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      serverSeq: 0,
    };
    await this.ctx.db.transaction("rw", [this.ctx.db.tags, this.ctx.db.outbox], async () => {
      await this.ctx.db.tags.put(tag);
      await this.queue("tags", tag.id, "create", { name: tag.name, color });
    });
    this.done();
    return tag;
  }
}

export function clampDuration(s: number): number {
  return Math.max(0, Math.min(MAX_ENTRY_SECONDS, Math.round(s)));
}

/**
 * Where a duration-only entry (grid, "add 2h") goes on the calendar: after the
 * person's other entries that day, starting at the organisation's workday start.
 */
export function nextFreeStart(
  dayEntries: TimeEntry[],
  date: string,
  workdayStart: string,
  timezone: string,
): number {
  let start = zonedToInstant(date, workdayStart, timezone);
  for (const e of [...dayEntries].sort((a, b) => a.startedAt - b.startedAt)) {
    const end = e.startedAt + (e.durationS ?? 0) * 1000;
    if (end > start) start = end;
  }
  return start;
}

/**
 * Weekly-grid cell edit: make the entries for (project, task, day) add up to
 * `targetSeconds` with the fewest changes. Grows the most recent grid entry (or
 * adds one); shrinks the most recent entries first, deleting any that reach 0.
 */
export function planCellChange(
  cellEntries: TimeEntry[],
  targetSeconds: number,
): { updates: { id: string; durationS: number }[]; deletes: string[]; add: number } {
  const current = cellEntries.reduce((s, e) => s + (e.durationS ?? 0), 0);
  const diff = targetSeconds - current;
  const out = { updates: [] as { id: string; durationS: number }[], deletes: [] as string[], add: 0 };
  if (diff === 0) return out;
  const finished = cellEntries.filter((e) => e.durationS !== null).sort((a, b) => b.startedAt - a.startedAt);
  if (diff > 0) {
    const grid = finished.find((e) => e.source === "grid");
    if (grid) out.updates.push({ id: grid.id, durationS: (grid.durationS ?? 0) + diff });
    else out.add = diff;
    return out;
  }
  let remove = -diff;
  for (const e of finished) {
    if (remove <= 0) break;
    const d = e.durationS ?? 0;
    if (d <= remove) {
      out.deletes.push(e.id);
      remove -= d;
    } else {
      out.updates.push({ id: e.id, durationS: d - remove });
      remove = 0;
    }
  }
  return out;
}

export type { Project, Task };
