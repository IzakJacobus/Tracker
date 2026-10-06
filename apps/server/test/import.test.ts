import { describe, expect, test } from "bun:test";
import { createTestServer } from "./helpers.ts";

const TOGGL = [
  "User,Email,Client,Project,Task,Description,Billable,Start date,Start time,End date,End time,Duration,Tags,Amount (USD)",
  'Aisha Patel,AISHA@example.co.za,Drakenstein,Paarl bridge upgrade,Site visit,"Inspection, east abutment",Yes,2026-09-28,08:30:00,2026-09-28,10:00:00,01:30:00,"site, travel",',
  "Aisha Patel,aisha@example.co.za,,Admin,,Timesheets,No,2026-09-28,10:00:00,2026-09-28,10:15:00,00:15:00,,",
  "Jan Toggl,jan@old-company.com,Drakenstein,Paarl bridge upgrade,,Design,Yes,2026-09-28,09:00:00,2026-09-28,11:00:00,02:00:00,,",
  "Aisha Patel,aisha@example.co.za,Drakenstein,Paarl bridge upgrade,,Bad row,Yes,someday,09:00:00,,,01:00:00,,",
].join("\n");

type Summary = {
  dryRun: boolean;
  format: string;
  imported: number;
  duplicates: number;
  errors: { line: number; message: string }[];
  unmatchedPeople: string[];
  created: { clients: string[]; projects: string[]; tasks: string[]; tags: string[] };
};

async function setup() {
  const t = createTestServer();
  const admin = await t.setup();
  const aisha = await t.createUser(admin, {
    name: "Aisha Patel",
    email: "aisha@example.co.za",
    role: "member",
  });
  return { t, admin, aisha };
}

describe("CSV import", () => {
  test("is admin-only", async () => {
    const { t, aisha } = await setup();
    expect(
      (await t.json("POST", "/api/admin/import", { as: aisha.agent, body: { csv: TOGGL } })).status,
    ).toBe(403);
  });

  test("a dry run reports exactly what would happen and changes nothing", async () => {
    const { t, admin } = await setup();
    const seqBefore = t.ctx.db
      .query<{ v: string }, []>("SELECT value AS v FROM app_meta WHERE key = 'server_seq'")
      .get();
    const r = await t.json<Summary>("POST", "/api/admin/import", { as: admin, body: { csv: TOGGL } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ dryRun: true, format: "toggl", imported: 2, duplicates: 0 });
    expect(r.body.unmatchedPeople).toEqual(["jan@old-company.com"]);
    expect(r.body.errors.map((e) => e.line)).toEqual([4, 5]);
    expect(r.body.created).toEqual({
      clients: ["Drakenstein"],
      // A task column becomes one more level of items (0.2).
      projects: [
        "Drakenstein › Paarl bridge upgrade",
        "Drakenstein › Paarl bridge upgrade › Site visit",
        "Internal › Admin",
      ],
      tasks: [],
      tags: ["site", "travel"],
    });
    expect(t.ctx.db.query("SELECT 1 FROM time_entries").get()).toBeNull();
    expect(t.ctx.db.query("SELECT 1 FROM clients WHERE name = 'Drakenstein'").get()).toBeNull();
    const seqAfter = t.ctx.db
      .query<{ v: string }, []>("SELECT value AS v FROM app_meta WHERE key = 'server_seq'")
      .get();
    expect(seqAfter).toEqual(seqBefore);
  });

  test("imports entries, maps unknown people, and is safe to run twice", async () => {
    const { t, admin, aisha } = await setup();
    const jan = await t.createUser(admin, {
      name: "Jan van Wyk",
      email: "jan@example.co.za",
      role: "member",
    });
    const body = { csv: TOGGL, dryRun: false, people: { "jan@old-company.com": jan.id } };
    const r = await t.json<Summary>("POST", "/api/admin/import", { as: admin, body });
    expect(r.body.imported).toBe(3);
    expect(r.body.errors.map((e) => e.line)).toEqual([5]);

    const rows = t.ctx.db
      .query<
        {
          user_id: string;
          started_at: number;
          duration_s: number;
          source: string;
          entry_date: string;
        },
        []
      >(
        "SELECT user_id, started_at, duration_s, source, entry_date FROM time_entries ORDER BY started_at, user_id",
      )
      .all();
    expect(rows).toHaveLength(3);
    // 08:30 SAST is 06:30 UTC.
    expect(rows[0]).toMatchObject({
      user_id: aisha.id,
      started_at: Date.UTC(2026, 8, 28, 6, 30),
      duration_s: 5400,
    });
    expect(rows.every((x) => x.source === "import" && x.entry_date === "2026-09-28")).toBe(true);
    // "Admin" without a client lands under Internal.
    const admin2 = t.ctx.db
      .query<{ internal: number }, []>(
        "SELECT c.is_internal AS internal FROM projects p JOIN clients c ON c.id = p.client_id WHERE p.name = 'Admin'",
      )
      .get();
    expect(admin2?.internal).toBe(1);

    // The member can now see the imported project through sync.
    const pull = await t.json<{ changes: { table: string; row: { name?: string } }[] }>(
      "GET",
      "/api/sync/pull?since=0&limit=1000",
      { as: aisha.agent },
    );
    expect(pull.status).toBe(200);
    expect(JSON.stringify(pull.body.changes)).toContain("Paarl bridge upgrade");

    const again = await t.json<Summary>("POST", "/api/admin/import", { as: admin, body });
    expect(again.body.imported).toBe(0);
    expect(again.body.duplicates).toBe(3);
    expect(t.ctx.db.query("SELECT 1 FROM audit_log WHERE action = 'import'").all()).toHaveLength(1);
  });

  test("without createMissing, unknown projects are errors", async () => {
    const { t, admin } = await setup();
    const r = await t.json<Summary>("POST", "/api/admin/import", {
      as: admin,
      body: { csv: TOGGL, createMissing: false },
    });
    expect(r.body.imported).toBe(0);
    expect(r.body.errors.find((e) => e.line === 2)?.message).toBe('There is no client called "Drakenstein".');
  });
});
