import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appliedMigrations, checksum, MigrationError, migrate } from "../src/db/migrate.ts";
import { migrations } from "../src/db/migrations/index.ts";
import { openDatabase } from "../src/db/open.ts";

describe("migrations", () => {
  test("apply cleanly to an empty database", () => {
    const db = openDatabase(":memory:");
    const res = migrate(db, migrations);
    expect(res.applied).toEqual(migrations.map((m) => m.version));
    const tables = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((t) => t.name);
    for (const t of ["users", "clients", "projects", "tasks", "time_entries", "timesheets", "audit_log"]) {
      expect(tables).toContain(t);
    }
  });

  test("are idempotent", () => {
    const db = openDatabase(":memory:");
    migrate(db, migrations);
    expect(migrate(db, migrations).applied).toEqual([]);
  });

  test("record checksums", () => {
    const db = openDatabase(":memory:");
    migrate(db, migrations);
    const rows = appliedMigrations(db);
    expect(rows[0]!.checksum).toBe(checksum(migrations[0]!.sql));
  });

  test("detect a modified migration", () => {
    const db = openDatabase(":memory:");
    migrate(db, migrations);
    const tampered = migrations.map((m, i) => (i === 0 ? { ...m, sql: `${m.sql}\n-- edited` } : m));
    expect(() => migrate(db, tampered)).toThrow(MigrationError);
  });

  test("refuse to downgrade", () => {
    const db = openDatabase(":memory:");
    const future = [
      ...migrations,
      { version: migrations.length + 1, name: "future", sql: "CREATE TABLE f (x INTEGER)" },
    ];
    migrate(db, future);
    expect(() => migrate(db, migrations)).toThrow(/newer than this version/);
  });

  test("roll back a failing migration and keep earlier ones", () => {
    const db = openDatabase(":memory:");
    const broken = [
      ...migrations,
      {
        version: migrations.length + 1,
        name: "broken",
        sql: "CREATE TABLE ok (x INTEGER); SELECT * FROM nope;",
      },
    ];
    expect(() => migrate(db, broken)).toThrow();
    expect(appliedMigrations(db).length).toBe(migrations.length);
    const t = db.query("SELECT name FROM sqlite_master WHERE name='ok'").get();
    expect(t).toBeNull();
  });

  test("calls beforeApply only when there is work", () => {
    const db = openDatabase(":memory:");
    let calls = 0;
    migrate(db, migrations, { beforeApply: () => calls++ });
    migrate(db, migrations, { beforeApply: () => calls++ });
    expect(calls).toBe(1);
  });

  test("uses WAL on disk and enforces foreign keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "stint-"));
    try {
      const db = openDatabase(join(dir, "t.db"));
      const mode = db.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get();
      expect(mode?.journal_mode).toBe("wal");
      migrate(db, migrations);
      expect(() =>
        db.run(
          "INSERT INTO projects (id, client_id, name, created_at, updated_at) VALUES ('p', 'missing', 'x', 0, 0)",
        ),
      ).toThrow();
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
