import { describe, expect, test } from "bun:test";
import type { OrgSettings, Project, Timesheet } from "@stint/shared";
import { migrate } from "../src/db/migrate.ts";
import { migrations } from "../src/db/migrations/index.ts";
import { openDatabase } from "../src/db/open.ts";
import { createTestServer } from "./helpers.ts";

describe("0.3 migration", () => {
  test("drops expected hours per week and keeps weekly organisations on their weeks", () => {
    const db = openDatabase(":memory:");
    migrate(db, migrations.slice(0, 3));
    db.query(
      "INSERT INTO organization (id, name, settings, created_at, updated_at) VALUES ('org', 'Acme', ?, 0, 0)",
    ).run(JSON.stringify({ approvalPeriod: "week", weekStart: 1 }));
    expect(migrate(db, migrations).applied).toEqual([4, 5]);
    const cols = db
      .query<{ name: string }, []>("PRAGMA table_info(users)")
      .all()
      .map((c) => c.name);
    expect(cols).not.toContain("weekly_capacity_minutes");
    // Monday–Sunday weeks end on Sunday (0).
    const settings = JSON.parse(
      db.query<{ settings: string }, []>("SELECT settings FROM organization").get()!.settings,
    );
    expect(settings).toEqual({ approvalPeriod: "week", weekStart: 1, approvalDay: 0 });
    expect(db.query("SELECT value FROM app_meta WHERE key = 'sync_epoch'").get()).toEqual({ value: "4" });
  });

  test("monthly organisations are left alone", () => {
    const db = openDatabase(":memory:");
    migrate(db, migrations.slice(0, 3));
    db.query(
      "INSERT INTO organization (id, name, settings, created_at, updated_at) VALUES ('org', 'Acme', ?, 0, 0)",
    ).run(JSON.stringify({ approvalPeriod: "month", weekStart: 1 }));
    migrate(db, migrations);
    const settings = JSON.parse(
      db.query<{ settings: string }, []>("SELECT settings FROM organization").get()!.settings,
    );
    expect(settings).toEqual({ approvalPeriod: "month", weekStart: 1 });
  });
});

describe("approvals every week, on a day the company chooses", () => {
  async function world() {
    const s = createTestServer(Date.parse("2026-10-30T10:00:00Z"));
    const admin = await s.setup();
    const alice = await s.createUser(admin, { email: "alice@example.com", name: "Alice" });
    return { s, admin, alice };
  }
  const submit = (w: Awaited<ReturnType<typeof world>>, date: string) =>
    w.s.json<Timesheet>("POST", "/api/timesheets/submit", { as: w.alice.agent, body: { date } });

  test("new companies hand in weekly, on Fridays", async () => {
    const w = await world();
    const org = await w.s.json<{ settings: OrgSettings }>("GET", "/api/org", { as: w.admin });
    expect(org.body.settings).toMatchObject({ approvalPeriod: "week", approvalDay: 5 });
    const r = await submit(w, "2026-09-30");
    expect(r.status).toBe(200);
    // Saturday 26 Sept to Friday 2 Oct.
    expect(r.body).toMatchObject({ periodStart: "2026-09-26", periodEnd: "2026-10-02" });
  });

  test("the day can be changed", async () => {
    const w = await world();
    await w.s.json("PATCH", "/api/org", { as: w.admin, body: { settings: { approvalDay: 0 } } });
    const r = await submit(w, "2026-09-30");
    expect(r.body).toMatchObject({ periodStart: "2026-09-28", periodEnd: "2026-10-04" });
  });

  test("every two weeks gives fortnights that join up", async () => {
    const w = await world();
    await w.s.json("PATCH", "/api/org", { as: w.admin, body: { settings: { approvalPeriod: "biweek" } } });
    const a = await submit(w, "2026-09-30");
    expect(a.status).toBe(200);
    expect(a.body.periodEnd.slice(0, 4)).toBe("2026");
    // the day after it ends starts the next fortnight, 14 days long
    const next = new Date(Date.parse(`${a.body.periodEnd}T00:00:00Z`) + 86_400_000)
      .toISOString()
      .slice(0, 10);
    const b = await submit(w, next);
    expect(b.body.periodStart).toBe(next);
    expect((Date.parse(b.body.periodEnd) - Date.parse(b.body.periodStart)) / 86_400_000).toBe(13);
  });

  test("bad days are refused", async () => {
    const w = await world();
    const r = await w.s.json("PATCH", "/api/org", { as: w.admin, body: { settings: { approvalDay: 9 } } });
    expect(r.status).toBe(422);
  });
});

describe("marking done while tracking", () => {
  test("people who can log hours on an item can mark it done and reopen it; others can't", async () => {
    const s = createTestServer();
    const admin = await s.setup();
    const alice = await s.createUser(admin, { email: "alice@example.com", name: "Alice" });
    const bob = await s.createUser(admin, { email: "bob@example.com", name: "Bob" });
    const client = (
      await s.json<{ id: string }>("POST", "/api/clients", { as: admin, body: { name: "Acme" } })
    ).body;
    const root = (
      await s.json<Project>("POST", "/api/projects", {
        as: admin,
        body: { clientId: client.id, name: "Bridge", code: "B-1" },
      })
    ).body;
    const item = (
      await s.json<Project>("POST", "/api/projects", {
        as: admin,
        body: { parentId: root.id, name: "Design" },
      })
    ).body;
    await s.json("PUT", `/api/projects/${root.id}/members/${alice.id}`, { as: admin, body: {} });

    expect((await s.json("POST", `/api/projects/${item.id}/archive`, { as: bob.agent })).status).toBe(403);
    const done = await s.json<Project>("POST", `/api/projects/${item.id}/archive`, { as: alice.agent });
    expect(done.status).toBe(200);
    expect(done.body.archivedAt).not.toBeNull();
    const reopened = await s.json<Project>("POST", `/api/projects/${item.id}/unarchive`, { as: alice.agent });
    expect(reopened.body.archivedAt).toBeNull();
    // They still can't edit it.
    expect(
      (await s.json("PATCH", `/api/projects/${item.id}`, { as: alice.agent, body: { name: "x" } })).status,
    ).toBe(403);
  });
});
