import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "../src/db/migrate.ts";
import { migrations } from "../src/db/migrations/index.ts";
import { closeDatabase, openDatabase } from "../src/db/open.ts";
import { getMeta } from "../src/lib/meta.ts";
import {
  backupDue,
  inspectDatabase,
  lastBackup,
  lastSuccessfulBackup,
  listBackups,
  prune,
  runBackup,
} from "../src/services/backup.ts";
import { createTestServer } from "./helpers.ts";

const dirs: string[] = [];
const servers: ReturnType<typeof createTestServer>[] = [];
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), "stint-backup-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  // Windows can't delete a folder while a database inside it is still open.
  for (const t of servers.splice(0)) closeDatabase(t.ctx.db);
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A test server whose database is a real file, so backups and restores behave as in production. */
async function fileServer() {
  const dataDir = tempDir();
  const t = createTestServer();
  servers.push(t);
  t.ctx.db.close();
  const db = openDatabase(join(dataDir, "stint.db"));
  migrate(db, migrations);
  t.ctx.db = db;
  t.ctx.config = { ...t.ctx.config, dataDir };
  const admin = await t.setup();
  return { t, admin, dataDir };
}

describe("backups", () => {
  test("a backup is a complete, healthy copy of the database", async () => {
    const { t, dataDir } = await fileServer();
    const r = runBackup(t.ctx, "manual");
    expect(r.ok).toBe(true);
    expect(r.path?.startsWith(join(dataDir, "backups"))).toBe(true);
    expect(r.path).toMatch(/stint-2026-09-30-1000-manual\.db$/);
    const check = inspectDatabase(r.path!);
    expect(check).toMatchObject({
      ok: true,
      organization: "Karoo Consulting Engineers",
      schema: migrations.length,
    });
    const log = t.ctx.db.query<{ ok: number; kind: string }, []>("SELECT ok, kind FROM backup_log").all();
    expect(log).toEqual([{ ok: 1, kind: "manual" }]);
  });

  test("a folder that can't be written gives a plain-language error and is logged", async () => {
    const { t, dataDir } = await fileServer();
    const blocker = join(dataDir, "not-a-folder");
    writeFileSync(blocker, "x");
    const r = runBackup(t.ctx, "manual", join(blocker, "inside"));
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
    expect(t.ctx.db.query<{ ok: number }, []>("SELECT ok FROM backup_log").get()?.ok).toBe(0);
  });

  test("pruning keeps the newest N regular backups and up to 10 safety copies", () => {
    const folder = tempDir();
    for (let d = 1; d <= 9; d++) writeFileSync(join(folder, `stint-2026-09-0${d}-0200.db`), "");
    for (let d = 10; d <= 22; d++)
      writeFileSync(join(folder, `stint-2026-09-${d}-0900-pre-migration.db`), "");
    writeFileSync(join(folder, "holiday-photos.db"), "");
    const removed = prune(folder, 5);
    expect(removed).toHaveLength(4 + 3);
    const left = listBackups(folder).map((b) => b.name);
    expect(left.filter((n) => !n.includes("pre-"))).toEqual([
      "stint-2026-09-09-0200.db",
      "stint-2026-09-08-0200.db",
      "stint-2026-09-07-0200.db",
      "stint-2026-09-06-0200.db",
      "stint-2026-09-05-0200.db",
    ]);
    expect(left.filter((n) => n.includes("pre-"))).toHaveLength(10);
    expect(existsSync(join(folder, "holiday-photos.db"))).toBe(true);
  });

  test("inspect rejects files that aren't Stint databases", () => {
    const dir = tempDir();
    const junk = join(dir, "junk.db");
    writeFileSync(junk, "this is not sqlite");
    expect(inspectDatabase(junk).ok).toBe(false);
    const empty = join(dir, "empty.db");
    openDatabase(empty).close();
    expect(inspectDatabase(empty).ok).toBe(false);
  });
});

describe("backup schedule", () => {
  test("safety copies and folder tests don't count as tonight's backup", async () => {
    const { t, dataDir } = await fileServer();
    // 30 Sept 10:00 SAST: a manual backup, so nothing is due until 02:00 tomorrow.
    expect(runBackup(t.ctx, "manual").ok).toBe(true);
    expect(backupDue(t.ctx)).toBe(false);
    // 1 Oct 03:00 SAST: past the backup time, and only non-regular copies were made since.
    t.clock.advance(17 * 3600_000);
    runBackup(t.ctx, "pre-restore", join(dataDir, "restore-safety"));
    runBackup(t.ctx, "pre-migration");
    runBackup(t.ctx, "folder-test", join(dataDir, "elsewhere"));
    expect(lastSuccessfulBackup(t.ctx.db)).toBe(Date.UTC(2026, 8, 30, 8, 0));
    expect(backupDue(t.ctx)).toBe(true);
    runBackup(t.ctx, "scheduled");
    expect(backupDue(t.ctx)).toBe(false);
  });

  test("a failed folder test doesn't show up as a failed backup", async () => {
    const { t, dataDir } = await fileServer();
    expect(runBackup(t.ctx, "scheduled").ok).toBe(true);
    const blocker = join(dataDir, "a-file");
    writeFileSync(blocker, "x");
    expect(runBackup(t.ctx, "folder-test", join(blocker, "inside")).ok).toBe(false);
    expect(lastBackup(t.ctx.db)?.ok).toBe(true);
  });
});

describe("backup API", () => {
  test("only admins can see and run backups", async () => {
    const { t, admin } = await fileServer();
    const { agent: member } = await t.createUser(admin, {
      name: "Aisha",
      email: "aisha@example.co.za",
      role: "member",
    });
    expect((await t.json("GET", "/api/admin/backups", { as: member })).status).toBe(403);
    expect((await t.json("POST", "/api/admin/backups/run", { as: member, body: {} })).status).toBe(403);
    const run = await t.json<{ ok: boolean }>("POST", "/api/admin/backups/run", { as: admin, body: {} });
    expect(run.body.ok).toBe(true);
    const list = await t.json<{ files: { name: string }[]; last: { ok: boolean } }>(
      "GET",
      "/api/admin/backups",
      {
        as: admin,
      },
    );
    expect(list.body.files.map((f) => f.name)).toEqual(["stint-2026-09-30-1000-manual.db"]);
    expect(list.body.last.ok).toBe(true);
  });

  test("restore brings back the old data, keeps a safety copy and resets every client", async () => {
    const { t, admin, dataDir } = await fileServer();
    const before = await t.json<{ id: string }>("POST", "/api/clients", {
      as: admin,
      body: { name: "Drakenstein" },
    });
    expect(before.status).toBe(201);
    const backup = runBackup(t.ctx, "manual");
    t.clock.advance(3600_000);
    await t.json("POST", "/api/clients", { as: admin, body: { name: "Added after the backup" } });
    const epochBefore = Number(getMeta(t.ctx.db, "sync_epoch") ?? "0");
    const oldDb = t.ctx.db;

    const r = await t.json<{ ok: boolean; safetyCopy: string; restartRequired: boolean }>(
      "POST",
      "/api/admin/backups/restore",
      { as: admin, body: { name: "stint-2026-09-30-1000-manual.db" } },
    );
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.restartRequired).toBe(false);
    expect(t.ctx.db).not.toBe(oldDb);
    expect(r.body.safetyCopy.startsWith(join(dataDir, "restore-safety"))).toBe(true);
    expect(inspectDatabase(r.body.safetyCopy).ok).toBe(true);

    const names = t.ctx.db
      .query<{ name: string }, []>("SELECT name FROM clients WHERE is_internal = 0")
      .all();
    expect(names.map((n) => n.name)).toEqual(["Drakenstein"]);
    expect(Number(getMeta(t.ctx.db, "sync_epoch"))).toBeGreaterThan(epochBefore);
    expect(t.ctx.db.query("SELECT 1 FROM audit_log WHERE action = 'backup_restore'").get()).not.toBeNull();
    // The admin's session existed when the backup was made, so they stay signed in.
    expect((await t.json("GET", "/api/admin/backups", { as: admin })).status).toBe(200);
    expect(backup.ok).toBe(true);
  });

  test("restore refuses names outside the backup folders", async () => {
    const { t, admin } = await fileServer();
    const r = await t.json("POST", "/api/admin/backups/restore", {
      as: admin,
      body: { name: "../../etc/passwd" },
    });
    expect(r.status).toBe(422);
    const missing = await t.json("POST", "/api/admin/backups/restore", {
      as: admin,
      body: { name: "stint-2020-01-01-0200.db" },
    });
    expect(missing.status).toBe(404);
  });

  test("the folder browser lists folders and suggests places", async () => {
    const { t, admin, dataDir } = await fileServer();
    const r = await t.json<{ path: string; folders: { name: string }[]; suggestions: { path: string }[] }>(
      "GET",
      `/api/admin/fs?path=${encodeURIComponent(dataDir)}`,
      { as: admin },
    );
    expect(r.status).toBe(200);
    expect(r.body.path).toBe(dataDir);
    expect(r.body.suggestions[0]?.path).toBe(join(dataDir, "backups"));
  });
});
