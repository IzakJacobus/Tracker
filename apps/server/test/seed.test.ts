import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("demo seed", () => {
  test("creates a consistent demo company", () => {
    const dir = mkdtempSync(join(tmpdir(), "stint-seed-"));
    try {
      const r = Bun.spawnSync([process.execPath, join(import.meta.dir, "../scripts/seed.ts")], {
        env: { ...process.env, STINT_DATA_DIR: dir },
      });
      expect(r.exitCode).toBe(0);
      const db = new Database(join(dir, "stint.db"), { readonly: true });
      const one = (sql: string) => (db.query(sql).get() as { n: number }).n;
      expect(one("SELECT COUNT(*) n FROM users")).toBe(5);
      expect(one("SELECT COUNT(*) n FROM clients WHERE is_internal = 0")).toBeGreaterThanOrEqual(3);
      expect(one("SELECT COUNT(*) n FROM projects WHERE parent_id IS NOT NULL")).toBeGreaterThan(3);
      expect(one("SELECT COUNT(*) n FROM time_entries")).toBeGreaterThan(1000);
      // every entry's task belongs to the entry's project (the server enforces this on sync)
      expect(
        one(
          "SELECT COUNT(*) n FROM time_entries e JOIN tasks t ON t.id = e.task_id WHERE t.project_id != e.project_id",
        ),
      ).toBe(0);
      // every entry lies within 24 h
      expect(one("SELECT COUNT(*) n FROM time_entries WHERE duration_s IS NULL OR duration_s > 86400")).toBe(
        0,
      );
      // three months of history, with approved timesheets
      expect(
        one("SELECT COUNT(DISTINCT substr(entry_date, 1, 7)) n FROM time_entries"),
      ).toBeGreaterThanOrEqual(3);
      expect(one("SELECT COUNT(*) n FROM timesheets WHERE status = 'approved'")).toBeGreaterThan(0);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
