import type { Database } from "bun:sqlite";
import type { Migration } from "./migrations/index.ts";

export interface MigrationResult {
  applied: number[];
  current: number;
}

export class MigrationError extends Error {}

export function checksum(sql: string): string {
  return new Bun.CryptoHasher("sha256").update(sql).digest("hex");
}

function ensureTable(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    checksum   TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  ) STRICT`);
}

export function appliedMigrations(db: Database): { version: number; name: string; checksum: string }[] {
  ensureTable(db);
  return db
    .query<{ version: number; name: string; checksum: string }, []>(
      "SELECT version, name, checksum FROM schema_migrations ORDER BY version",
    )
    .all();
}

export function pendingMigrations(db: Database, all: Migration[]): Migration[] {
  const done = new Set(appliedMigrations(db).map((m) => m.version));
  return all.filter((m) => !done.has(m.version));
}

/**
 * Applies pending migrations, each in its own transaction.
 * Refuses to run if an already-applied migration has been modified, or if the
 * database is newer than this build (downgrade).
 */
export function migrate(
  db: Database,
  all: Migration[],
  hooks: { beforeApply?: (pending: Migration[]) => void } = {},
): MigrationResult {
  const sorted = [...all].sort((a, b) => a.version - b.version);
  sorted.forEach((m, i) => {
    if (m.version !== i + 1)
      throw new MigrationError(`Migration versions must be contiguous (got ${m.version})`);
  });

  const applied = appliedMigrations(db);
  const known = new Map(sorted.map((m) => [m.version, m]));
  for (const row of applied) {
    const m = known.get(row.version);
    if (!m) {
      throw new MigrationError(
        `Database is at schema version ${row.version}, which is newer than this version of Stint. Install the latest Stint Server or restore an older backup.`,
      );
    }
    if (checksum(m.sql) !== row.checksum) {
      throw new MigrationError(
        `Migration ${row.version} (${row.name}) has been modified after it was applied.`,
      );
    }
  }

  const pending = pendingMigrations(db, sorted);
  if (pending.length > 0) hooks.beforeApply?.(pending);

  const insert = db.prepare(
    "INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
  );
  try {
    for (const m of pending) {
      db.transaction(() => {
        db.run(m.sql);
        insert.run(m.version, m.name, checksum(m.sql), Date.now());
      })();
    }
  } finally {
    // An unfinalized statement stops db.close(true) from releasing the file (restore needs that).
    insert.finalize();
  }
  return { applied: pending.map((m) => m.version), current: sorted.length };
}
