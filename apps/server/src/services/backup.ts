import { Database } from "bun:sqlite";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { localDate, localTime } from "@stint/shared";
import type { AppContext } from "../context.ts";
import { migrate } from "../db/migrate.ts";
import { migrations } from "../db/migrations/index.ts";
import { openDatabase } from "../db/open.ts";
import { getMeta, setMeta } from "../lib/meta.ts";
import { invalidateAccessCache } from "./access.ts";
import { getOrgSettings } from "./org.ts";

export type BackupKind = "scheduled" | "manual" | "pre-migration" | "pre-restore";

export interface BackupResult {
  ok: boolean;
  path?: string;
  sizeBytes?: number;
  error?: string;
}

export interface BackupFile {
  name: string;
  path: string;
  sizeBytes: number;
  createdAt: number;
}

const FILE_RE = /^stint-\d{4}-\d{2}-\d{2}-\d{4}(?:-[a-z-]+)?\.db$/;

export function defaultBackupFolder(dataDir: string): string {
  return join(dataDir, "backups");
}

export function backupFolder(ctx: Pick<AppContext, "db" | "config">): string {
  return getOrgSettings(ctx.db).backup.folder ?? defaultBackupFolder(ctx.config.dataDir);
}

/** Checks a database file is a healthy Stint database. */
export function inspectDatabase(path: string): {
  ok: boolean;
  error?: string;
  organization?: string;
  schema?: number;
} {
  let db: Database | null = null;
  try {
    db = new Database(path, { readonly: true });
    const integrity = db
      .query<{ integrity_check: string }, []>("PRAGMA integrity_check")
      .get()?.integrity_check;
    if (integrity !== "ok") return { ok: false, error: `The file is damaged (${integrity}).` };
    const schema =
      db.query<{ v: number }, []>("SELECT MAX(version) AS v FROM schema_migrations").get()?.v ?? 0;
    const org = db.query<{ name: string }, []>("SELECT name FROM organization WHERE id = 'org'").get();
    if (!org) return { ok: false, error: "The file isn't a Stint database (no organisation found)." };
    return { ok: true, organization: org.name, schema };
  } catch (e) {
    return { ok: false, error: `The file isn't a Stint database: ${(e as Error).message}` };
  } finally {
    db?.close();
  }
}

/** Consistent online backup with VACUUM INTO, then an integrity check and pruning. */
export function runBackup(
  ctx: Pick<AppContext, "db" | "config" | "now" | "log">,
  kind: BackupKind,
  folder = backupFolder(ctx),
): BackupResult {
  const now = ctx.now();
  const settings = getOrgSettings(ctx.db);
  const stamp = `${localDate(now, settings.timezone)}-${localTime(now, settings.timezone).replace(":", "")}`;
  const name = `stint-${stamp}${kind === "scheduled" ? "" : `-${kind}`}.db`;
  const path = join(folder, name);
  try {
    mkdirSync(folder, { recursive: true });
    if (existsSync(path)) rmSync(path);
    ctx.db.run(`VACUUM INTO '${path.replace(/'/g, "''")}'`);
    const check = inspectDatabase(path);
    if (!check.ok) throw new Error(check.error);
    const sizeBytes = statSync(path).size;
    log(ctx, now, path, sizeBytes, true, "", kind);
    prune(folder, settings.backup.keep);
    ctx.log.info("Backup written", { path, sizeBytes, kind });
    return { ok: true, path, sizeBytes };
  } catch (e) {
    const error = friendly(e as Error, folder);
    log(ctx, now, path, 0, false, error, kind);
    ctx.log.error("Backup failed", { path, error });
    return { ok: false, path, error };
  }
}

function friendly(e: Error, folder: string): string {
  const m = e.message;
  if (/EACCES|EPERM|permission/i.test(m))
    return `Stint isn't allowed to write to ${folder}. Choose another folder.`;
  if (/ENOSPC|full/i.test(m)) return `The backup drive (${folder}) is full.`;
  if (/ENOENT|unable to open|no such/i.test(m))
    return `The folder ${folder} isn't available. Is the USB drive plugged in?`;
  return m;
}

function log(
  ctx: Pick<AppContext, "db">,
  at: number,
  path: string,
  size: number,
  ok: boolean,
  error: string,
  kind: BackupKind,
) {
  ctx.db
    .query("INSERT INTO backup_log (at, path, size_bytes, ok, error, kind) VALUES (?, ?, ?, ?, ?, ?)")
    .run(at, path, size, ok ? 1 : 0, error, kind);
}

export function listBackups(folder: string): BackupFile[] {
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .filter((f) => FILE_RE.test(f))
    .map((name) => {
      const path = join(folder, name);
      const st = statSync(path);
      return { name, path, sizeBytes: st.size, createdAt: st.mtimeMs };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

/** Keeps the newest `keep` scheduled/manual backups (safety copies are pruned too, separately). */
export function prune(folder: string, keep: number): string[] {
  const removed: string[] = [];
  const all = listBackups(folder);
  const regular = all.filter((b) => !/-pre-(migration|restore)\.db$/.test(b.name));
  const safety = all.filter((b) => /-pre-(migration|restore)\.db$/.test(b.name));
  for (const b of [...regular.slice(keep), ...safety.slice(10)]) {
    rmSync(b.path, { force: true });
    removed.push(b.name);
  }
  return removed;
}

export function lastBackup(
  db: Database,
): { at: number; ok: boolean; path: string; error: string; sizeBytes: number } | null {
  const r = db
    .query<{ at: number; ok: number; path: string; error: string; size_bytes: number }, []>(
      "SELECT at, ok, path, error, size_bytes FROM backup_log ORDER BY id DESC LIMIT 1",
    )
    .get();
  return r ? { at: r.at, ok: r.ok === 1, path: r.path, error: r.error, sizeBytes: r.size_bytes } : null;
}

export function lastSuccessfulBackup(db: Database): number | null {
  return db.query<{ at: number }, []>("SELECT MAX(at) AS at FROM backup_log WHERE ok = 1").get()?.at ?? null;
}

export interface RestoreResult {
  ok: boolean;
  error?: string;
  safetyCopy?: string;
  /** The restored data came from another server (different certificate), so a restart is needed. */
  restartRequired?: boolean;
}

/**
 * Replaces the live database with a backup. A safety copy of the current data is
 * made first; afterwards migrations run and every client re-syncs from scratch.
 * If anything goes wrong after the swap, the safety copy is put back.
 */
export function restoreBackup(ctx: AppContext, file: string): RestoreResult {
  const check = inspectDatabase(file);
  if (!check.ok) return { ok: false, error: check.error };
  if ((check.schema ?? 0) > migrations.length) {
    return {
      ok: false,
      error: "This backup was made by a newer version of Stint. Update Stint Server first, then restore.",
    };
  }
  const safety = runBackup(ctx, "pre-restore", join(ctx.config.dataDir, "restore-safety"));
  if (!safety.ok || !safety.path)
    return { ok: false, error: `Couldn't make a safety copy first: ${safety.error}` };
  const dbPath = join(ctx.config.dataDir, "stint.db");
  const previousEpoch = Number(getMeta(ctx.db, "sync_epoch") ?? "0");
  const previousCa = getMeta(ctx.db, "tls_ca_cert");

  const swapIn = (source: string) => {
    ctx.db.close();
    for (const suffix of ["-wal", "-shm"]) rmSync(`${dbPath}${suffix}`, { force: true });
    copyFileSync(source, dbPath);
    const db = openDatabase(dbPath);
    ctx.db = db;
    invalidateAccessCache(db);
    return db;
  };

  try {
    const db = swapIn(file);
    migrate(db, migrations);
    // A new epoch tells every client to throw away its copy and pull again.
    const epoch = Math.max(previousEpoch, Number(getMeta(db, "sync_epoch") ?? "0")) + 1;
    setMeta(db, "sync_epoch", String(epoch));
    const restartRequired = getMeta(db, "tls_ca_cert") !== previousCa;
    ctx.log.warn("Database restored from backup", { file, safetyCopy: safety.path, restartRequired });
    return { ok: true, safetyCopy: safety.path, restartRequired };
  } catch (e) {
    ctx.log.error("Restore failed, putting the previous data back", e);
    const db = swapIn(safety.path);
    setMeta(db, "sync_epoch", String(previousEpoch + 1));
    return { ok: false, error: `Restore failed and your previous data was kept: ${(e as Error).message}` };
  }
}

/** Runs the nightly backup at the configured local time, and catches up after downtime. */
export function startBackupScheduler(ctx: AppContext): () => void {
  const tick = () => {
    try {
      if (!ctx.db.query("SELECT 1 FROM organization").get()) return;
      const s = getOrgSettings(ctx.db);
      const now = ctx.now();
      const last = lastSuccessfulBackup(ctx.db);
      const today = localDate(now, s.timezone);
      const due = localTime(now, s.timezone) >= s.backup.time;
      const doneToday =
        last !== null &&
        localDate(last, s.timezone) === today &&
        localTime(last, s.timezone) >= s.backup.time;
      const overdue = last === null || now - last > 26 * 3600_000;
      if ((due && !doneToday) || overdue) runBackup(ctx, "scheduled");
    } catch (e) {
      ctx.log.error("Backup scheduler error", e);
    }
  };
  const first = setTimeout(tick, 30_000);
  const t = setInterval(tick, 60_000);
  return () => {
    clearTimeout(first);
    clearInterval(t);
  };
}

/* ------------------------------------------------------------------ */
/* Folder browser (admin): lets people pick a USB or OneDrive folder   */
/* on the server PC from any browser.                                  */
/* ------------------------------------------------------------------ */

export interface FolderListing {
  path: string | null;
  parent: string | null;
  folders: { name: string; path: string }[];
  suggestions: { label: string; path: string }[];
}

function safeDirs(path: string): { name: string; path: string }[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith(".") && !d.name.startsWith("$"))
      .map((d) => ({ name: d.name, path: join(path, d.name) }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 500);
  } catch {
    return [];
  }
}

export function suggestedFolders(dataDir: string): { label: string; path: string }[] {
  const out: { label: string; path: string }[] = [
    { label: "On this computer (default)", path: defaultBackupFolder(dataDir) },
  ];
  if (process.platform === "win32") {
    for (const letter of "DEFGHIJKLMNOPQRSTUVWXYZ") {
      const root = `${letter}:\\`;
      if (existsSync(root))
        out.push({ label: `Drive ${letter}: (USB or second disk)`, path: join(root, "Stint backups") });
    }
    const users = "C:\\Users";
    for (const u of safeDirs(users)) {
      for (const d of safeDirs(u.path)) {
        if (/^OneDrive/i.test(d.name))
          out.push({ label: `${d.name} (${u.name})`, path: join(d.path, "Stint backups") });
      }
    }
  } else {
    for (const base of ["/media", "/mnt", "/Volumes"]) {
      for (const d of safeDirs(base))
        out.push({ label: `${d.name} (removable)`, path: join(d.path, "Stint backups") });
    }
    const home = homedir();
    for (const d of safeDirs(home)) {
      if (/^OneDrive|^Dropbox|^Google Drive/i.test(d.name))
        out.push({ label: d.name, path: join(d.path, "Stint backups") });
    }
  }
  return out;
}

export function browseFolders(path: string | null, dataDir: string): FolderListing {
  if (!path) {
    const roots =
      process.platform === "win32"
        ? [..."CDEFGHIJKLMNOPQRSTUVWXYZ"]
            .map((l) => `${l}:\\`)
            .filter((r) => existsSync(r))
            .map((r) => ({ name: r, path: r }))
        : [
            { name: "/", path: "/" },
            { name: basename(homedir()), path: homedir() },
          ];
    return { path: null, parent: null, folders: roots, suggestions: suggestedFolders(dataDir) };
  }
  const p = resolve(path);
  const parent = dirname(p) === p ? null : dirname(p);
  return { path: p, parent, folders: safeDirs(p), suggestions: suggestedFolders(dataDir) };
}
