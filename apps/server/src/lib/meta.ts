import type { Database } from "bun:sqlite";

export function getMeta(db: Database, key: string): string | null {
  return (
    db.query<{ value: string }, [string]>("SELECT value FROM app_meta WHERE key = ?").get(key)?.value ?? null
  );
}

export function setMeta(db: Database, key: string, value: string): void {
  db.query(
    "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}
