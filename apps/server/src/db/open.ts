import { Database } from "bun:sqlite";

/** Opens (or creates) the SQLite database with Stint's standard pragmas. */
export function openDatabase(path: string): Database {
  const db = new Database(path, { create: true, strict: true });
  if (path !== ":memory:") db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA synchronous = NORMAL");
  db.run("PRAGMA foreign_keys = ON");
  db.run("PRAGMA busy_timeout = 5000");
  return db;
}

/**
 * Closes the database and releases its files, so they can be replaced or deleted (Windows
 * refuses while a handle is open). close(true) finalizes cached statements first. Bun before
 * 1.4 can't always do that (its statement cache drops statements without finalizing them) and
 * throws "database is locked"; then fall back to a deferred close, which is fine on Linux.
 */
export function closeDatabase(db: Database): void {
  try {
    db.close(true);
  } catch {
    db.close(false);
  }
}
