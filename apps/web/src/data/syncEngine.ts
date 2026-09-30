import type { HlcClock, Organization } from "@stint/shared";
import type { Table } from "dexie";
import { ApiError, api, NetworkError } from "../lib/api.ts";
import { type OutboxChange, type StintDB, SYNC_TABLES, type SyncTable } from "./db.ts";

export type SyncState = "synced" | "pending" | "syncing" | "offline" | "error";

export interface SyncStatus {
  state: SyncState;
  pending: number;
  lastSyncedAt: number | null;
  error: string | null;
  /** changes the server refused, most recent first (for the details popover) */
  rejected: { at: number; message: string }[];
}

interface PullResponse {
  changes: Partial<Record<SyncTable, ({ id: string; deletedAt: number | null } & Record<string, unknown>)[]>>;
  organization: Organization | null;
  cursor: number;
  hasMore: boolean;
  epoch: string;
  serverTime: number;
}

interface PushResponse {
  results: {
    changeId: string;
    table: OutboxChange["table"];
    id: string;
    status: "accepted" | "merged" | "noop" | "rejected";
    code?: string;
    message?: string;
    row: ({ id: string; deletedAt: number | null } & Record<string, unknown>) | null;
  }[];
  serverHlc: string;
}

type Listener = (s: SyncStatus) => void;

/**
 * Keeps the local IndexedDB copy in step with the server.
 * Pull: incremental by change sequence; a changed epoch triggers a full re-sync.
 */
export class SyncEngine {
  private status: SyncStatus = {
    state: "syncing",
    pending: 0,
    lastSyncedAt: null,
    error: null,
    rejected: [],
  };
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  private stopped = false;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private unlisten: (() => void) | null = null;
  onOrganization?: (org: Organization) => void;
  /** Called with a plain-language message when the server refuses a change. */
  onRejected?: (message: string) => void;

  constructor(
    readonly db: StintDB,
    readonly clock?: HlcClock,
    private readonly intervalMs = 20_000,
  ) {}

  get(): SyncStatus {
    return this.status;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<SyncStatus>) {
    this.status = { ...this.status, ...patch };
    for (const l of this.listeners) l(this.status);
  }

  start(): void {
    this.stop();
    this.stopped = false;
    const kick = () => void this.syncNow();
    const onVisible = () => {
      if (document.visibilityState === "visible") kick();
    };
    this.timer = setInterval(kick, this.intervalMs);
    window.addEventListener("online", kick);
    window.addEventListener("focus", kick);
    document.addEventListener("visibilitychange", onVisible);
    this.unlisten = () => {
      window.removeEventListener("online", kick);
      window.removeEventListener("focus", kick);
      document.removeEventListener("visibilitychange", onVisible);
    };
    kick();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    if (this.debounce) clearTimeout(this.debounce);
    this.unlisten?.();
    this.unlisten = null;
  }

  /** Call after writing to the outbox: updates the pending count now, syncs shortly. */
  async notifyLocalChange(): Promise<void> {
    const pending = await this.db.outbox.count();
    if (this.status.state !== "offline" && this.status.state !== "error")
      this.set({ state: "pending", pending });
    else this.set({ pending });
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.syncNow(), 400);
  }

  /** Runs a sync; if one is already running, schedules exactly one more. */
  syncNow(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        await this.cycle();
      } while (this.again && !this.stopped);
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async cycle(): Promise<void> {
    const pendingBefore = await this.db.outbox.count();
    // Background refreshes stay quiet; only show "Syncing" when there is something to send.
    if (pendingBefore > 0 || this.status.lastSyncedAt === null)
      this.set({ state: "syncing", pending: pendingBefore });
    try {
      await this.push();
      await this.pull();
      const pending = await this.db.outbox.count();
      this.set({ state: pending ? "pending" : "synced", pending, lastSyncedAt: Date.now(), error: null });
    } catch (e) {
      const pending = await this.db.outbox.count();
      if (e instanceof NetworkError) this.set({ state: "offline", pending, error: null });
      else if (e instanceof ApiError && e.status === 401)
        this.set({ state: "error", pending, error: "Your session has ended. Please sign in again." });
      else this.set({ state: "error", pending, error: e instanceof Error ? e.message : String(e) });
    }
  }

  /** Sends queued local changes in order, then reconciles with the server's answer. */
  async push(): Promise<void> {
    for (let round = 0; round < 100; round++) {
      const batch = await this.db.outbox.orderBy("seq").limit(200).toArray();
      if (batch.length === 0) return;
      const res = await api.post<PushResponse>("/sync/push", {
        changes: batch.map((c) => ({
          changeId: c.changeId,
          table: c.table,
          id: c.id,
          op: c.op,
          patch: c.patch,
          hlc: c.hlc,
        })),
      });
      this.clock?.observe(res.serverHlc);
      const rejected: string[] = [];
      await this.db.transaction(
        "rw",
        [this.db.outbox, this.db.timeEntries, this.db.favorites, this.db.tags],
        async () => {
          await this.db.outbox.bulkDelete(batch.map((c) => c.seq!));
          const remaining = await this.db.outbox.toArray();
          for (const r of res.results) {
            const table = this.db.table_(r.table);
            const stillPending = remaining.filter((c) => c.table === r.table && c.id === r.id);
            if (r.row && !r.row.deletedAt) {
              // Server truth, with any newer local edits re-applied on top.
              let row = r.row as Record<string, unknown>;
              for (const p of stillPending) row = { ...row, ...p.patch };
              await table.put(row as { id: string });
            } else if (stillPending.length === 0) {
              await table.delete(r.id);
            }
            if (r.status === "rejected") rejected.push(r.message ?? "The server didn't accept a change.");
          }
        },
      );
      if (rejected.length) {
        const at = Date.now();
        this.set({
          rejected: [
            ...rejected.map((message, i) => ({ at: at + i, message })),
            ...this.status.rejected,
          ].slice(0, 20),
        });
        for (const m of new Set(rejected)) this.onRejected?.(m);
      }
    }
  }

  async pull(): Promise<void> {
    let since = (await this.db.getMeta<number>("cursor")) ?? 0;
    const knownEpoch = await this.db.getMeta<string>("epoch");
    for (let page = 0; page < 1000; page++) {
      const res = await api.get<PullResponse>(`/sync/pull?since=${since}&limit=1000`);
      if (knownEpoch !== undefined && res.epoch !== knownEpoch && since !== 0) {
        // Visibility changed (new project assignment, role change, restore): start again from scratch.
        await this.resetLocalCopy();
        since = 0;
        await this.db.setMeta("epoch", res.epoch);
        continue;
      }
      await this.apply(res);
      since = res.cursor;
      if (!res.hasMore) break;
    }
  }

  private async resetLocalCopy(): Promise<void> {
    const tables: Table[] = [...SYNC_TABLES.map((t) => this.db.table_(t)), this.db.meta];
    await this.db.transaction("rw", tables, async () => {
      for (const t of SYNC_TABLES) await this.db.table_(t).clear();
      await this.db.setMeta("cursor", 0);
    });
  }

  private async apply(res: PullResponse): Promise<void> {
    const tables = SYNC_TABLES.map((t) => this.db.table_(t));
    await this.db.transaction("rw", [...tables, this.db.meta, this.db.outbox], async () => {
      for (const t of SYNC_TABLES) {
        const rows = res.changes[t];
        if (!rows?.length) continue;
        const live = rows.filter((r) => !r.deletedAt);
        const dead = rows.filter((r) => r.deletedAt).map((r) => r.id);
        if (live.length) await this.db.table_(t).bulkPut(await this.rebase(t, live));
        if (dead.length) await this.db.table_(t).bulkDelete(dead);
      }
      if (res.organization) await this.db.setMeta("organization", res.organization);
      await this.db.setMeta("cursor", res.cursor);
      await this.db.setMeta("epoch", res.epoch);
      await this.db.setMeta("serverTimeOffset", res.serverTime - Date.now());
    });
    if (res.organization) this.onOrganization?.(res.organization);
  }

  /**
   * Local changes not yet accepted by the server are re-applied on top of
   * incoming rows, so a pull never visually undoes what the user just did.
   */
  private async rebase<T extends { id: string }>(table: SyncTable, rows: T[]): Promise<T[]> {
    if (table !== "timeEntries" && table !== "favorites" && table !== "tags") return rows;
    const pending = await this.db.outbox
      .where("table")
      .equals(table)
      .toArray()
      .catch(() => []);
    if (!pending.length) return rows;
    const byId = new Map<string, Record<string, unknown>>();
    for (const ch of pending.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))) {
      byId.set(ch.id, { ...(byId.get(ch.id) ?? {}), ...ch.patch });
    }
    return rows.map((r) => (byId.has(r.id) ? ({ ...r, ...byId.get(r.id) } as T) : r));
  }
}
