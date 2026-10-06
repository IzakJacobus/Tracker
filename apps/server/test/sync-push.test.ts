import { describe, expect, test } from "bun:test";
import { type Client, formatHlc, type Project, type TimeEntry, uuidv7 } from "@stint/shared";
import { type Agent, createTestServer } from "./helpers.ts";

interface PushResult {
  changeId: string;
  status: "accepted" | "merged" | "noop" | "rejected";
  code?: string;
  message?: string;
  row: (TimeEntry & Record<string, unknown>) | null;
}

let seq = 0;
const hlc = (ms: number, node = "devA") => formatHlc({ ms, counter: 0, node });

async function world() {
  const s = createTestServer(Date.UTC(2026, 8, 30, 8, 0));
  const admin = await s.setup();
  const alice = await s.createUser(admin, { email: "alice@example.com", name: "Alice" });
  const bob = await s.createUser(admin, { email: "bob@example.com", name: "Bob" });
  const client = (await s.json<Client>("POST", "/api/clients", { as: admin, body: { name: "Acme" } })).body;
  const project = (
    await s.json<Project>("POST", "/api/projects", {
      as: admin,
      body: { clientId: client.id, name: "Bridge" },
    })
  ).body;
  const other = (
    await s.json<Project>("POST", "/api/projects", {
      as: admin,
      body: { clientId: client.id, name: "Secret" },
    })
  ).body;
  await s.json("PUT", `/api/projects/${project.id}/members/${alice.id}`, { as: admin, body: {} });
  await s.json("PUT", `/api/projects/${project.id}/members/${bob.id}`, { as: admin, body: {} });

  const pushAs = async (as: Agent, changes: Record<string, unknown>[]) =>
    (
      await s.json<{ results: PushResult[]; serverHlc: string }>("POST", "/api/sync/push", {
        as,
        body: { changes },
      })
    ).body;
  const entry = (id: string, patch: Record<string, unknown>, at: number, op = "create", node = "devA") => ({
    changeId: `c${++seq}`,
    table: "timeEntries",
    id,
    op,
    patch,
    hlc: hlc(at, node),
  });
  const now = s.clock.now;
  const startedAt = Date.UTC(2026, 8, 29, 7, 0); // 09:00 in Johannesburg, 29 Sept
  /** An item under `parentId`, created as admin. */
  const item = async (parentId: string, name: string, extra: Record<string, unknown> = {}) =>
    (await s.json<Project>("POST", "/api/projects", { as: admin, body: { parentId, name, ...extra } })).body;
  return { s, admin, alice, bob, client, project, other, item, pushAs, entry, now, startedAt };
}

function dbEntry(s: ReturnType<typeof createTestServer>, id: string) {
  return s.ctx.db
    .query<
      {
        description: string;
        duration_s: number | null;
        entry_date: string;
        deleted_at: number | null;
        project_id: string;
      },
      [string]
    >("SELECT * FROM time_entries WHERE id = ?")
    .get(id);
}

describe("sync push: time entries", () => {
  test("a member creates an entry; the server derives the date; nothing about money is stored", async () => {
    const w = await world();
    const id = uuidv7();
    const r = await w.pushAs(w.alice.agent, [
      w.entry(
        id,
        { projectId: w.project.id, description: "Design", startedAt: w.startedAt, durationS: 3600 },
        w.now,
      ),
    ]);
    expect(r.results[0]!.status).toBe("accepted");
    const row = dbEntry(w.s, id)!;
    expect(row.entry_date).toBe("2026-09-29");
    expect(Object.keys(row)).not.toContain("rate_snapshot");
    expect(Object.keys(row)).not.toContain("billable");
    expect(Object.keys(r.results[0]!.row!).sort()).not.toContain("rateSnapshot");
  });

  test("the entry date follows the organisation's time zone, not UTC", async () => {
    const w = await world();
    const id = uuidv7();
    const lateEvening = Date.UTC(2026, 8, 29, 22, 30); // 00:30 on 30 Sept in Johannesburg
    await w.pushAs(w.alice.agent, [
      w.entry(id, { projectId: w.project.id, startedAt: lateEvening, durationS: 600 }, w.now),
    ]);
    expect(dbEntry(w.s, id)!.entry_date).toBe("2026-09-30");
  });

  test("members cannot track on projects they're not assigned to", async () => {
    const w = await world();
    const r = await w.pushAs(w.alice.agent, [
      w.entry(uuidv7(), { projectId: w.other.id, startedAt: w.startedAt, durationS: 60 }, w.now),
    ]);
    expect(r.results[0]).toMatchObject({ status: "rejected", code: "forbidden", row: null });
  });

  test("members cannot edit or delete someone else's entry", async () => {
    const w = await world();
    const id = uuidv7();
    await w.pushAs(w.bob.agent, [
      w.entry(
        id,
        {
          projectId: w.project.id,
          startedAt: w.startedAt,
          durationS: 60,
          description: "confidential client call",
        },
        w.now,
      ),
    ]);
    const r = await w.pushAs(w.alice.agent, [
      w.entry(id, { description: "mine now" }, w.now + 1, "update"),
      w.entry(id, {}, w.now + 2, "delete"),
      w.entry(id, {}, w.now + 3, "update"),
    ]);
    expect(r.results.map((x) => x.code)).toEqual(["forbidden", "forbidden", "forbidden"]);
    expect(dbEntry(w.s, id)!.deleted_at).toBeNull();
    // A rejection must not hand back the other person's entry.
    expect(r.results.map((x) => x.row)).toEqual([null, null, null]);
    expect(JSON.stringify(r)).not.toContain("confidential");
  });

  test("server-owned fields can't be set by the client", async () => {
    const w = await world();
    const id = uuidv7();
    await w.pushAs(w.alice.agent, [
      w.entry(
        id,
        {
          projectId: w.project.id,
          startedAt: w.startedAt,
          durationS: 60,
          userId: w.bob.id,
          entryDate: "1999-01-01",
          billable: false,
          rateSnapshot: 1,
        },
        w.now,
      ),
    ]);
    const row = w.s.ctx.db
      .query<Record<string, unknown>, [string]>("SELECT * FROM time_entries WHERE id = ?")
      .get(id)!;
    expect(row.user_id).toBe(w.alice.id);
    expect(row.entry_date).toBe("2026-09-29");
    // Old clients may still send billing fields; they are ignored (there's nowhere to store them).
    expect(Object.keys(row).some((k) => /rate|billable|currency/.test(k))).toBe(false);
  });

  test("two devices editing different fields: both edits survive", async () => {
    const w = await world();
    const id = uuidv7();
    await w.pushAs(w.alice.agent, [
      w.entry(
        id,
        { projectId: w.project.id, startedAt: w.startedAt, durationS: 60, description: "x" },
        w.now,
      ),
    ]);
    await w.pushAs(w.alice.agent, [
      w.entry(id, { description: "from laptop" }, w.now + 5000, "update", "laptop"),
    ]);
    const late = await w.pushAs(w.alice.agent, [
      w.entry(id, { durationS: 5400 }, w.now + 3000, "update", "desktop"),
    ]);
    expect(late.results[0]!.status).toBe("accepted");
    const row = dbEntry(w.s, id)!;
    expect(row.description).toBe("from laptop");
    expect(row.duration_s).toBe(5400);
  });

  test("an older edit arriving late loses, and the client gets the winning row back", async () => {
    const w = await world();
    const id = uuidv7();
    await w.pushAs(w.alice.agent, [
      w.entry(
        id,
        { projectId: w.project.id, startedAt: w.startedAt, durationS: 60, description: "x" },
        w.now,
      ),
    ]);
    await w.pushAs(w.alice.agent, [w.entry(id, { description: "newer" }, w.now + 5000, "update", "laptop")]);
    const r = await w.pushAs(w.alice.agent, [
      w.entry(id, { description: "older" }, w.now + 1000, "update", "desktop"),
    ]);
    expect(r.results[0]!.status).toBe("noop");
    expect(r.results[0]!.row!.description).toBe("newer");
  });

  test("a deleted entry is never revived by a later edit", async () => {
    const w = await world();
    const id = uuidv7();
    await w.pushAs(w.alice.agent, [
      w.entry(id, { projectId: w.project.id, startedAt: w.startedAt, durationS: 60 }, w.now),
    ]);
    await w.pushAs(w.alice.agent, [w.entry(id, {}, w.now + 1000, "delete")]);
    const r = await w.pushAs(w.alice.agent, [
      w.entry(id, { description: "zombie" }, w.now + 9000, "update", "other"),
    ]);
    expect(r.results[0]).toMatchObject({ status: "noop", code: "deleted" });
    expect(dbEntry(w.s, id)!.deleted_at).not.toBeNull();
  });

  test("approved periods are locked: edits, deletes and new entries are rejected", async () => {
    const w = await world();
    const id = uuidv7();
    await w.pushAs(w.alice.agent, [
      w.entry(id, { projectId: w.project.id, startedAt: w.startedAt, durationS: 60 }, w.now),
    ]);
    w.s.ctx.db
      .query(
        "INSERT INTO timesheets (id, user_id, period_start, period_end, status, created_at, updated_at) VALUES (?, ?, '2026-09-01', '2026-09-30', 'approved', 0, 0)",
      )
      .run(uuidv7(), w.alice.id);
    const r = await w.pushAs(w.alice.agent, [
      w.entry(id, { description: "after approval" }, w.now + 1000, "update"),
      w.entry(id, {}, w.now + 2000, "delete"),
      w.entry(uuidv7(), { projectId: w.project.id, startedAt: w.startedAt, durationS: 60 }, w.now + 3000),
    ]);
    expect(r.results.map((x) => x.code)).toEqual(["locked", "locked", "locked"]);
    expect(r.results[0]!.message).toContain("approved");
    // moving an open entry into the locked month is rejected too
    const oct = uuidv7();
    await w.pushAs(w.alice.agent, [
      w.entry(oct, { projectId: w.project.id, startedAt: Date.UTC(2026, 9, 1, 8), durationS: 60 }, w.now),
    ]);
    const mv = await w.pushAs(w.alice.agent, [
      w.entry(oct, { startedAt: w.startedAt }, w.now + 4000, "update"),
    ]);
    expect(mv.results[0]!.code).toBe("locked");
  });

  test("there is no timer: an entry without hours is refused", async () => {
    const w = await world();
    const r = await w.pushAs(w.alice.agent, [
      w.entry(
        uuidv7(),
        { projectId: w.project.id, startedAt: w.now, durationS: null, source: "timer" },
        w.now,
      ),
    ]);
    expect(r.results[0]).toMatchObject({ status: "rejected", message: "Enter the hours." });
  });

  test("validation: 24-hour cap, no tasks, and hours only on the lowest open item", async () => {
    const w = await world();
    const phase = await w.item(w.project.id, "Design", { kind: "Phase" });
    const wp = await w.item(phase.id, "WP1", { kind: "Work package" });
    const closed = await w.item(phase.id, "Concept", { kind: "Work package" });
    const underClosed = await w.item(closed.id, "Sketches", { kind: "Task" });
    await w.s.json("POST", `/api/projects/${closed.id}/archive`, { as: w.admin, body: {} });
    const e = (projectId: string, extra: Record<string, unknown> = {}) =>
      w.entry(uuidv7(), { projectId, startedAt: w.startedAt, durationS: 60, ...extra }, w.now);
    const r = await w.pushAs(w.alice.agent, [
      e(wp.id, { durationS: 90_000 }),
      e(wp.id, { taskId: uuidv7() }),
      w.entry(uuidv7(), { startedAt: w.startedAt, durationS: 60 }, w.now),
      e(w.project.id),
      e(phase.id),
      e(closed.id),
      e(underClosed.id),
      e(wp.id),
    ]);
    expect(r.results.map((x) => x.status)).toEqual([
      "rejected",
      "rejected",
      "rejected",
      "rejected",
      "rejected",
      "rejected",
      "rejected",
      "accepted",
    ]);
    expect(r.results[3]!.message).toContain("hours go on the lowest level");
    expect(r.results[5]!.message).toContain("marked done");
    expect(r.results[6]!.message).toContain("marked done");
  });

  test("an older entry on an item that later got items under it stays editable, but can't move to a done item", async () => {
    const w = await world();
    const id = uuidv7();
    await w.pushAs(w.alice.agent, [
      w.entry(id, { projectId: w.project.id, startedAt: w.startedAt, durationS: 600 }, w.now),
    ]);
    const done = await w.item(w.project.id, "Finished part");
    await w.s.json("POST", `/api/projects/${done.id}/archive`, { as: w.admin, body: {} });
    const edit = await w.pushAs(w.alice.agent, [w.entry(id, { durationS: 900 }, w.now + 1000, "update")]);
    expect(edit.results[0]!.status).toBe("accepted");
    const move = await w.pushAs(w.alice.agent, [w.entry(id, { projectId: done.id }, w.now + 2000, "update")]);
    expect(move.results[0]!.status).toBe("rejected");
    expect(dbEntry(w.s, id)!.project_id).toBe(w.project.id);
  });

  test("one bad change in a batch doesn't block the good ones", async () => {
    const w = await world();
    const good = uuidv7();
    const r = await w.pushAs(w.alice.agent, [
      w.entry(uuidv7(), { projectId: w.other.id, startedAt: w.startedAt, durationS: 60 }, w.now),
      w.entry(good, { projectId: w.project.id, startedAt: w.startedAt, durationS: 60 }, w.now),
    ]);
    expect(r.results.map((x) => x.status)).toEqual(["rejected", "accepted"]);
    expect(dbEntry(w.s, good)).not.toBeNull();
  });

  test("a device clock years in the future can't win forever", async () => {
    const w = await world();
    const id = uuidv7();
    await w.pushAs(w.alice.agent, [
      w.entry(
        id,
        { projectId: w.project.id, startedAt: w.startedAt, durationS: 60, description: "a" },
        w.now,
      ),
    ]);
    await w.pushAs(w.alice.agent, [
      w.entry(id, { description: "wrong clock" }, Date.UTC(2099, 0, 1), "update", "broken"),
    ]);
    w.s.clock.advance(60_000);
    const r = await w.pushAs(w.alice.agent, [
      w.entry(id, { description: "fixed" }, w.s.clock.now, "update", "good"),
    ]);
    expect(r.results[0]!.status).toBe("accepted");
    expect(dbEntry(w.s, id)!.description).toBe("fixed");
  });

  test("every change to time data is audited", async () => {
    const w = await world();
    const id = uuidv7();
    await w.pushAs(w.alice.agent, [
      w.entry(id, { projectId: w.project.id, startedAt: w.startedAt, durationS: 60 }, w.now),
    ]);
    await w.pushAs(w.alice.agent, [w.entry(id, { description: "edited" }, w.now + 1, "update")]);
    await w.pushAs(w.alice.agent, [w.entry(id, {}, w.now + 2, "delete")]);
    const actions = w.s.ctx.db
      .query<{ action: string }, [string]>(
        "SELECT action FROM audit_log WHERE entity = 'time_entry' AND entity_id = ? ORDER BY id",
      )
      .all(id)
      .map((r) => r.action);
    expect(actions).toEqual(["create", "update", "delete"]);
  });

  test("pulls include pushed entries, for the people allowed to see them", async () => {
    const w = await world();
    const id = uuidv7();
    await w.pushAs(w.alice.agent, [
      w.entry(id, { projectId: w.project.id, startedAt: w.startedAt, durationS: 60 }, w.now),
    ]);
    const pull = await w.s.json<{ changes: { timeEntries?: TimeEntry[] } }>("GET", "/api/sync/pull?since=0", {
      as: w.admin,
    });
    expect(pull.body.changes.timeEntries?.find((e) => e.id === id)?.durationS).toBe(60);
    const bobPull = await w.s.json<{ changes: { timeEntries?: TimeEntry[] } }>(
      "GET",
      "/api/sync/pull?since=0",
      { as: w.bob.agent },
    );
    expect(bobPull.body.changes.timeEntries ?? []).toEqual([]);
  });
});

describe("sync push: favourites and tags", () => {
  test("favourites are personal", async () => {
    const w = await world();
    const fav = uuidv7();
    const r = await w.pushAs(w.alice.agent, [
      {
        changeId: "f1",
        table: "favorites",
        id: fav,
        op: "create",
        patch: { projectId: w.project.id },
        hlc: hlc(w.now),
      },
    ]);
    expect(r.results[0]!.status).toBe("accepted");
    const steal = await w.pushAs(w.bob.agent, [
      { changeId: "f2", table: "favorites", id: fav, op: "delete", patch: {}, hlc: hlc(w.now + 1) },
    ]);
    expect(steal.results[0]!.code).toBe("forbidden");
    expect(steal.results[0]!.row).toBeNull();
  });

  test("entries only take tags that exist, each once; a tag deleted later doesn't block edits", async () => {
    const w = await world();
    const tagId = uuidv7();
    const tag = (patch: Record<string, unknown>, op = "create") => ({
      changeId: `c${++seq}`,
      table: "tags",
      id: tagId,
      op,
      patch,
      hlc: hlc(w.s.clock.now),
    });
    await w.pushAs(w.admin, [tag({ name: "Overtime" })]);
    const base = { projectId: w.project.id, startedAt: w.startedAt, durationS: 600 };
    const tagged = uuidv7();
    const r = await w.pushAs(w.alice.agent, [
      w.entry(tagged, { ...base, tagIds: [tagId] }, w.now),
      w.entry(uuidv7(), { ...base, tagIds: [uuidv7()] }, w.now),
      w.entry(uuidv7(), { ...base, tagIds: [tagId, tagId] }, w.now),
    ]);
    expect(r.results.map((x) => x.status)).toEqual(["accepted", "rejected", "rejected"]);
    expect(r.results[1]!.message).toBe("That tag no longer exists.");

    w.s.clock.advance(1000);
    await w.pushAs(w.admin, [tag({}, "delete")]);
    w.s.clock.advance(1000);
    const edit = await w.pushAs(w.alice.agent, [
      w.entry(tagged, { description: "Still editable" }, w.s.clock.now, "update"),
    ]);
    expect(edit.results[0]!.status).toBe("accepted");
    w.s.clock.advance(1000);
    const readd = await w.pushAs(w.alice.agent, [
      w.entry(tagged, { tagIds: [tagId, uuidv7()] }, w.s.clock.now, "update"),
    ]);
    expect(readd.results[0]!.status).toBe("rejected");
  });

  test("anyone can create a tag offline; duplicates are rejected", async () => {
    const w = await world();
    const r = await w.pushAs(w.alice.agent, [
      {
        changeId: "t1",
        table: "tags",
        id: uuidv7(),
        op: "create",
        patch: { name: "Overtime" },
        hlc: hlc(w.now),
      },
      {
        changeId: "t2",
        table: "tags",
        id: uuidv7(),
        op: "create",
        patch: { name: "overtime" },
        hlc: hlc(w.now),
      },
    ]);
    expect(r.results.map((x) => x.status)).toEqual(["accepted", "rejected"]);
  });

  test("a favourite can't be repointed at an off-limits project or a task from elsewhere", async () => {
    const w = await world();
    const fav = uuidv7();
    const f = (id: string, op: string, patch: Record<string, unknown>, at: number) => ({
      changeId: `f${++seq}`,
      table: "favorites",
      id,
      op,
      patch,
      hlc: hlc(at),
    });
    expect(
      (await w.pushAs(w.alice.agent, [f(fav, "create", { projectId: w.project.id }, w.now)])).results[0]!
        .status,
    ).toBe("accepted");
    const r = await w.pushAs(w.alice.agent, [
      f(fav, "update", { projectId: w.other.id }, w.now + 1),
      f(fav, "update", { taskId: uuidv7() }, w.now + 2),
      f(fav, "update", { sortOrder: 3 }, w.now + 3),
    ]);
    expect(r.results.map((x) => x.code ?? x.status)).toEqual(["forbidden", "invalid", "accepted"]);
    const row = w.s.ctx.db
      .query<{ project_id: string; task_id: string | null; sort_order: number }, [string]>(
        "SELECT project_id, task_id, sort_order FROM favorites WHERE id = ?",
      )
      .get(fav);
    expect(row).toEqual({ project_id: w.project.id, task_id: null, sort_order: 3 });
  });

  test("one broken change in a batch is rejected on its own instead of failing the whole push", async () => {
    const w = await world();
    const id = uuidv7();
    const res = await w.s.json<{ results: PushResult[] }>("POST", "/api/sync/push", {
      as: w.alice.agent,
      body: {
        changes: [
          w.entry(id, { projectId: w.project.id, startedAt: w.startedAt, durationS: 600 }, w.now),
          {
            changeId: "bad-fav",
            table: "favorites",
            id: uuidv7(),
            op: "create",
            patch: { projectId: w.project.id, taskId: uuidv7() },
            hlc: hlc(w.now),
          },
        ],
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.results.map((x) => x.status)).toEqual(["accepted", "rejected"]);
    expect(dbEntry(w.s, id)).not.toBeNull();
  });

  test("renaming a tag gets the same checks as creating one", async () => {
    const w = await world();
    const a = uuidv7();
    const b = uuidv7();
    const t = (id: string, op: string, patch: Record<string, unknown>, at: number) => ({
      changeId: `t${++seq}`,
      table: "tags",
      id,
      op,
      patch,
      hlc: hlc(at),
    });
    await w.pushAs(w.admin, [
      t(a, "create", { name: "Site" }, w.now),
      t(b, "create", { name: "Travel" }, w.now),
    ]);
    const r = await w.pushAs(w.admin, [
      t(b, "update", { name: "site" }, w.now + 1),
      t(b, "update", { color: "javascript:x" }, w.now + 2),
      t(b, "update", { name: "   " }, w.now + 3),
      t(b, "update", { name: `  ${"x".repeat(80)}  `, color: "#112233" }, w.now + 4),
      t(a, "update", { name: "SITE" }, w.now + 5),
    ]);
    expect(r.results.map((x) => x.code ?? x.status)).toEqual([
      "duplicate",
      "invalid",
      "invalid",
      "accepted",
      "accepted",
    ]);
    const rows = w.s.ctx.db
      .query<{ id: string; name: string; color: string }, []>(
        "SELECT id, name, color FROM tags ORDER BY name",
      )
      .all();
    expect(rows.find((x) => x.id === b)).toEqual({ id: b, name: "x".repeat(60), color: "#112233" });
    // Renaming a tag to a different case of its own name is fine.
    expect(rows.find((x) => x.id === a)?.name).toBe("SITE");
  });

  test("the push body is validated", async () => {
    const w = await world();
    const r = await w.s.json("POST", "/api/sync/push", {
      as: w.alice.agent,
      body: { changes: [{ table: "users", id: "x" }] },
    });
    expect(r.status).toBe(422);
  });
});
