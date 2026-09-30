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
