import type { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { migrate } from "../src/db/migrate.ts";
import { migrations } from "../src/db/migrations/index.ts";
import { openDatabase } from "../src/db/open.ts";
import { closeRunningTimers } from "../src/services/timers.ts";

const T = 1_790_000_000_000;

/** A 0.1 database: schema version 1, a project with tasks, entries and a favourite on a task. */
function v01(): Database {
  const db = openDatabase(":memory:");
  migrate(db, migrations.slice(0, 1));
  const run = (sql: string, ...args: (string | number | null)[]) => db.query(sql).run(...args);
  run("UPDATE sync_counter SET seq = 100 WHERE id = 1");
  run(
    "INSERT INTO users (id, email, name, role, password_hash, created_at, updated_at, server_seq) VALUES ('u1', 'a@x.test', 'Aisha', 'member', 'x', ?, ?, 1)",
    T,
    T,
  );
  run(
    "INSERT INTO clients (id, name, created_at, updated_at, server_seq) VALUES ('c1', 'Acme', ?, ?, 2)",
    T,
    T,
  );
  run(
    "INSERT INTO projects (id, client_id, name, color, visibility, created_at, updated_at, server_seq) VALUES ('p1', 'c1', 'Bridge', '#b3361f', 'everyone', ?, ?, 3)",
    T,
    T,
  );
  run(
    "INSERT INTO tasks (id, project_id, name, rate, sort_order, archived_at, created_at, updated_at, server_seq) VALUES ('t1', 'p1', 'Site visit', 120000, 0, NULL, ?, ?, 4)",
    T,
    T,
  );
  run(
    "INSERT INTO tasks (id, project_id, name, sort_order, archived_at, created_at, updated_at, server_seq) VALUES ('t2', 'p1', 'Old work', 1, ?, ?, ?, 5)",
    T,
    T,
    T,
  );
  const entry = (id: string, task: string | null, seq: number) =>
    run(
      "INSERT INTO time_entries (id, user_id, project_id, task_id, started_at, duration_s, entry_date, created_at, updated_at, server_seq) VALUES (?, 'u1', 'p1', ?, ?, 3600, '2026-09-21', ?, ?, ?)",
      id,
      task,
      T,
      T,
      T,
      seq,
    );
  entry("e1", "t1", 6);
  entry("e2", "t2", 7);
  entry("e3", null, 8);
  run(
    "INSERT INTO favorites (id, user_id, project_id, task_id, created_at, updated_at, server_seq) VALUES ('f1', 'u1', 'p1', 't1', ?, ?, 9)",
    T,
    T,
  );
  return db;
}

describe("0.2 item tree migration", () => {
  test("turns every task into an item under its project and moves its hours with it", () => {
    const db = v01();
    const before = db.query<{ seq: number }, []>("SELECT seq FROM sync_counter").get()!.seq;
    expect(migrate(db, migrations.slice(0, 2)).applied).toEqual([2]);

    const items = db
      .query<
        {
          id: string;
          parent_id: string;
          client_id: string;
          name: string;
          kind: string;
          rate: number | null;
          archived_at: number | null;
          visibility: string;
        },
        []
      >(
        "SELECT id, parent_id, client_id, name, kind, rate, archived_at, visibility FROM projects WHERE parent_id IS NOT NULL ORDER BY sort_order",
      )
      .all();
    expect(items).toEqual([
      {
        id: "t1",
        parent_id: "p1",
        client_id: "c1",
        name: "Site visit",
        kind: "Task",
        rate: 120000,
        archived_at: null,
        visibility: "everyone",
      },
      {
        id: "t2",
        parent_id: "p1",
        client_id: "c1",
        name: "Old work",
        kind: "Task",
        rate: null,
        archived_at: T,
        visibility: "everyone",
      },
    ]);

    const entries = db
      .query<{ id: string; project_id: string; task_id: string | null }, []>(
        "SELECT id, project_id, task_id FROM time_entries ORDER BY id",
      )
      .all();
    expect(entries).toEqual([
      { id: "e1", project_id: "t1", task_id: null },
      { id: "e2", project_id: "t2", task_id: null },
      { id: "e3", project_id: "p1", task_id: null },
    ]);
    expect(db.query("SELECT project_id, task_id FROM favorites").get()).toEqual({
      project_id: "t1",
      task_id: null,
    });
    expect(
      db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM tasks WHERE deleted_at IS NULL").get()!.n,
    ).toBe(0);

    // Every changed row has a fresh, unique sync number, and every browser re-downloads.
    const seqs = db
      .query<{ s: number }, []>(
        "SELECT server_seq AS s FROM projects WHERE parent_id IS NOT NULL UNION ALL SELECT server_seq FROM time_entries WHERE id IN ('e1','e2') UNION ALL SELECT server_seq FROM favorites UNION ALL SELECT server_seq FROM tasks",
      )
      .all()
      .map((r) => r.s);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(Math.min(...seqs)).toBeGreaterThan(before);
    const after = db.query<{ seq: number }, []>("SELECT seq FROM sync_counter").get()!.seq;
    expect(after).toBe(Math.max(...seqs));
    expect(db.query("SELECT value FROM app_meta WHERE key = 'sync_epoch'").get()).toEqual({ value: "1" });
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  test("timers still running from 0.1 are stopped with the time they ran, at most 24 hours", () => {
    const db = v01();
    migrate(db, migrations);
    db.query("UPDATE time_entries SET duration_s = NULL WHERE id IN ('e1', 'e3')").run();
    db.query("UPDATE time_entries SET started_at = ? WHERE id = 'e3'").run(T - 3 * 86_400_000);
    expect(closeRunningTimers(db, T + 90 * 60_000)).toBe(2);
    const d = db
      .query<{ id: string; duration_s: number }, []>("SELECT id, duration_s FROM time_entries ORDER BY id")
      .all();
    expect(d).toEqual([
      { id: "e1", duration_s: 90 * 60 },
      { id: "e2", duration_s: 3600 },
      { id: "e3", duration_s: 86_400 },
    ]);
    expect(
      db
        .query<{ n: number }, []>(
          "SELECT COUNT(*) AS n FROM audit_log WHERE reason LIKE '%no longer has a timer%'",
        )
        .get()!.n,
    ).toBe(2);
    expect(closeRunningTimers(db, T + 100 * 60_000)).toBe(0);
  });
});

describe("0.2 billing removal migration", () => {
  test("drops every rate, billable flag, money budget and billing setting, and keeps the hours", () => {
    const db = v01();
    db.query("UPDATE users SET rate = 145000").run();
    db.query("UPDATE clients SET rate = 95000").run();
    db.query("UPDATE projects SET rate = 100000, billable_default = 0, budget_amount = 5000000").run();
    db.query("UPDATE time_entries SET billable = 0, rate_snapshot = 100000, currency = 'ZAR'").run();
    db.query(
      "INSERT INTO organization (id, name, settings, created_at, updated_at) VALUES ('org', 'Acme Eng', ?, 0, 0)",
    ).run(
      JSON.stringify({
        currency: "ZAR",
        defaultRate: 85000,
        rounding: { mode: "up", minutes: 6 },
        membersSeeOwnRates: true,
        idleMinutes: 10,
        timezone: "Africa/Johannesburg",
        pdf: { vatNumber: "4870261943", registration: "2011/004217/07" },
      }),
    );
    const hours = () =>
      db
        .query<{ s: number }, []>("SELECT SUM(duration_s) AS s FROM time_entries WHERE deleted_at IS NULL")
        .get()!.s;
    const before = hours();
    expect(migrate(db, migrations).applied).toEqual([2, 3]);

    const billing = /^(rate|billable|billable_default|budget_amount|rate_snapshot|currency)$/;
    for (const table of ["users", "clients", "projects", "project_members", "tasks", "time_entries"]) {
      const cols = db
        .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
        .all()
        .map((c) => c.name);
      expect(cols.filter((c) => billing.test(c))).toEqual([]);
    }
    const settings = JSON.parse(
      db.query<{ settings: string }, []>("SELECT settings FROM organization").get()!.settings,
    );
    expect(settings).toEqual({
      timezone: "Africa/Johannesburg",
      pdf: { registration: "2011/004217/07" },
    });
    expect(hours()).toBe(before);
    expect(db.query("SELECT value FROM app_meta WHERE key = 'sync_epoch'").get()).toEqual({ value: "2" });
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
