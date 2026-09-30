import { describe, expect, test } from "bun:test";
import { type Client, formatHlc, type Project, type Timesheet, uuidv7 } from "@stint/shared";
import { type Agent, createTestServer } from "./helpers.ts";

// 30 Sept 2026, 10:00 Johannesburg
const NOW = Date.UTC(2026, 8, 30, 8, 0);
let n = 0;

async function world() {
  const s = createTestServer(NOW);
  const admin = await s.setup();
  const mgr = await s.createUser(admin, { email: "mgr@example.com", name: "Pieter", role: "manager" });
  const alice = await s.createUser(admin, { email: "alice@example.com", name: "Alice", managerId: mgr.id });
  const bob = await s.createUser(admin, { email: "bob@example.com", name: "Bob" }); // no manager
  const client = (
    await s.json<Client>("POST", "/api/clients", { as: admin, body: { name: "Acme", rate: 100000 } })
  ).body;
  const project = (
    await s.json<Project>("POST", "/api/projects", {
      as: admin,
      body: { clientId: client.id, name: "Bridge" },
    })
  ).body;
  for (const u of [alice, bob, mgr])
    await s.json("PUT", `/api/projects/${project.id}/members/${u.id}`, { as: admin, body: {} });
  const addEntry = async (as: Agent, date: string, minutes = 60, extra: Record<string, unknown> = {}) => {
    const id = uuidv7();
    const r = await s.json<{ results: { status: string; code?: string }[] }>("POST", "/api/sync/push", {
      as,
      body: {
        changes: [
          {
            changeId: `c${++n}`,
            table: "timeEntries",
            id,
            op: "create",
            patch: {
              projectId: project.id,
              startedAt: Date.parse(`${date}T07:00:00Z`),
              durationS: minutes * 60,
              ...extra,
            },
            hlc: formatHlc({ ms: s.clock.now + n, counter: 0, node: "dev" }),
          },
        ],
      },
    });
    return { id, result: r.body.results[0]! };
  };
  const editEntry = async (as: Agent, id: string, patch: Record<string, unknown>) =>
    (
      await s.json<{ results: { status: string; code?: string }[] }>("POST", "/api/sync/push", {
        as,
        body: {
          changes: [
            {
              changeId: `c${++n}`,
              table: "timeEntries",
              id,
              op: "update",
              patch,
              hlc: formatHlc({ ms: s.clock.now + n, counter: 0, node: "dev" }),
            },
          ],
        },
      })
    ).body.results[0]!;
  return { s, admin, mgr, alice, bob, client, project, addEntry, editEntry };
}

describe("timesheet workflow", () => {
  test("submit → approve locks the period; edits are rejected", async () => {
    const w = await world();
    const { id } = await w.addEntry(w.alice.agent, "2026-09-10");
    const sub = await w.s.json<Timesheet>("POST", "/api/timesheets/submit", {
      as: w.alice.agent,
      body: { date: "2026-09-15" },
    });
    expect(sub.status).toBe(200);
    expect(sub.body).toMatchObject({
      status: "submitted",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
    });
    // locked while waiting for approval
    expect((await w.editEntry(w.alice.agent, id, { description: "late change" })).code).toBe("locked");
    const ok = await w.s.json<Timesheet>("POST", `/api/timesheets/${sub.body.id}/approve`, {
      as: w.mgr.agent,
      body: {},
    });
    expect(ok.body.status).toBe("approved");
    expect((await w.editEntry(w.alice.agent, id, { description: "still locked" })).code).toBe("locked");
    expect((await w.addEntry(w.alice.agent, "2026-09-20")).result.code).toBe("locked");
    // next month is open
    expect((await w.addEntry(w.alice.agent, "2026-10-01")).result.status).toBe("accepted");
  });

  test("reject sends it back with a comment and unlocks it for changes", async () => {
    const w = await world();
    const { id } = await w.addEntry(w.alice.agent, "2026-09-10");
    const sub = (
      await w.s.json<Timesheet>("POST", "/api/timesheets/submit", {
        as: w.alice.agent,
        body: { date: "2026-09-10" },
      })
    ).body;
    const noComment = await w.s.json("POST", `/api/timesheets/${sub.id}/reject`, {
      as: w.mgr.agent,
      body: { comment: "" },
    });
    expect(noComment.status).toBe(422);
    const rej = await w.s.json<Timesheet>("POST", `/api/timesheets/${sub.id}/reject`, {
      as: w.mgr.agent,
      body: { comment: "Please split the site visit from design." },
    });
    expect(rej.body).toMatchObject({
      status: "rejected",
      comment: "Please split the site visit from design.",
    });
    expect((await w.editEntry(w.alice.agent, id, { description: "split" })).status).toBe("accepted");
    // and can be submitted again
    const again = await w.s.json<Timesheet>("POST", "/api/timesheets/submit", {
      as: w.alice.agent,
      body: { date: "2026-09-10" },
    });
    expect(again.body.status).toBe("submitted");
    expect(again.body.id).toBe(sub.id);
  });

  test("only the person's manager (or an admin) approves; never yourself", async () => {
    const w = await world();
    const bobSheet = (
      await w.s.json<Timesheet>("POST", "/api/timesheets/submit", {
        as: w.bob.agent,
        body: { date: "2026-09-10" },
      })
    ).body;
    expect(
      (await w.s.json("POST", `/api/timesheets/${bobSheet.id}/approve`, { as: w.mgr.agent, body: {} }))
        .status,
    ).toBe(403);
    expect(
      (await w.s.json("POST", `/api/timesheets/${bobSheet.id}/approve`, { as: w.alice.agent, body: {} }))
        .status,
    ).toBe(403);
    expect(
      (await w.s.json("POST", `/api/timesheets/${bobSheet.id}/approve`, { as: w.admin, body: {} })).status,
    ).toBe(200);
    const mgrSheet = (
      await w.s.json<Timesheet>("POST", "/api/timesheets/submit", {
        as: w.mgr.agent,
        body: { date: "2026-09-10" },
      })
    ).body;
    const self = await w.s.json<{ error: { message: string } }>(
      "POST",
      `/api/timesheets/${mgrSheet.id}/approve`,
      { as: w.mgr.agent, body: {} },
    );
    expect(self.status).toBe(403);
    expect(self.body.error.message).toContain("Someone else");
  });

  test("members can't submit for others; admins can", async () => {
    const w = await world();
    expect(
      (
        await w.s.json("POST", "/api/timesheets/submit", {
          as: w.alice.agent,
          body: { date: "2026-09-10", userId: w.bob.id },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await w.s.json("POST", "/api/timesheets/submit", {
          as: w.admin,
          body: { date: "2026-09-10", userId: w.bob.id },
        })
      ).status,
    ).toBe(200);
  });

  test("can't submit a future period, twice, or with a running timer", async () => {
    const w = await world();
    expect(
      (await w.s.json("POST", "/api/timesheets/submit", { as: w.alice.agent, body: { date: "2026-11-02" } }))
        .status,
    ).toBe(400);
    await w.addEntry(w.alice.agent, "2026-09-29", 0, { durationS: null });
    const running = await w.s.json<{ error: { message: string } }>("POST", "/api/timesheets/submit", {
      as: w.alice.agent,
      body: { date: "2026-09-29" },
    });
    expect(running.status).toBe(409);
    expect(running.body.error.message).toContain("timer");
    await w.s.json("POST", "/api/timesheets/submit", { as: w.bob.agent, body: { date: "2026-08-10" } });
    expect(
      (await w.s.json("POST", "/api/timesheets/submit", { as: w.bob.agent, body: { date: "2026-08-10" } }))
        .status,
    ).toBe(409);
  });

  test("withdraw returns a submitted timesheet to draft", async () => {
    const w = await world();
    const sub = (
      await w.s.json<Timesheet>("POST", "/api/timesheets/submit", {
        as: w.alice.agent,
        body: { date: "2026-09-10" },
      })
    ).body;
    const wd = await w.s.json<Timesheet>("POST", `/api/timesheets/${sub.id}/withdraw`, { as: w.alice.agent });
    expect(wd.body.status).toBe("draft");
  });

  test("admins unlock with a reason recorded in the audit log", async () => {
    const w = await world();
    const { id } = await w.addEntry(w.alice.agent, "2026-09-10");
    const sub = (
      await w.s.json<Timesheet>("POST", "/api/timesheets/submit", {
        as: w.alice.agent,
        body: { date: "2026-09-10" },
      })
    ).body;
    await w.s.json("POST", `/api/timesheets/${sub.id}/approve`, { as: w.mgr.agent, body: {} });
    expect(
      (
        await w.s.json("POST", `/api/timesheets/${sub.id}/unlock`, {
          as: w.mgr.agent,
          body: { reason: "typo" },
        })
      ).status,
    ).toBe(403);
    expect(
      (await w.s.json("POST", `/api/timesheets/${sub.id}/unlock`, { as: w.admin, body: { reason: "" } }))
        .status,
    ).toBe(422);
    const un = await w.s.json<Timesheet>("POST", `/api/timesheets/${sub.id}/unlock`, {
      as: w.admin,
      body: { reason: "Client asked to move 2 h to another work package" },
    });
    expect(un.body.status).toBe("draft");
    expect((await w.editEntry(w.alice.agent, id, { description: "moved" })).status).toBe("accepted");
    const audit = await w.s.json<{ rows: { action: string; reason: string }[] }>(
      "GET",
      "/api/admin/audit?entity=timesheet",
      { as: w.admin },
    );
    expect(audit.body.rows.map((r) => r.action)).toEqual(["unlock", "approve", "submit"]);
    expect(audit.body.rows[0]!.reason).toContain("Client asked");
  });

  test("timesheets reach the team's manager through sync, not other members", async () => {
    const w = await world();
    await w.s.json("POST", "/api/timesheets/submit", { as: w.alice.agent, body: { date: "2026-09-10" } });
    const mgrPull = await w.s.json<{ changes: { timesheets?: Timesheet[] } }>(
      "GET",
      "/api/sync/pull?since=0",
      { as: w.mgr.agent },
    );
    expect(mgrPull.body.changes.timesheets?.length).toBe(1);
    const bobPull = await w.s.json<{ changes: { timesheets?: Timesheet[] } }>(
      "GET",
      "/api/sync/pull?since=0",
      { as: w.bob.agent },
    );
    expect(bobPull.body.changes.timesheets ?? []).toEqual([]);
  });
});

describe("admin tools", () => {
  test("audit log is admin-only and paginates", async () => {
    const w = await world();
    expect((await w.s.json("GET", "/api/admin/audit", { as: w.mgr.agent })).status).toBe(403);
    const first = await w.s.json<{ rows: { id: number }[]; next: number | null }>(
      "GET",
      "/api/admin/audit?limit=3",
      { as: w.admin },
    );
    expect(first.body.rows).toHaveLength(3);
    const second = await w.s.json<{ rows: { id: number }[] }>(
      "GET",
      `/api/admin/audit?limit=3&before=${first.body.next}`,
      { as: w.admin },
    );
    expect(second.body.rows[0]!.id).toBeLessThan(first.body.rows[2]!.id);
  });

  test("re-rate: dry run first, then apply; locked periods are skipped unless asked", async () => {
    const w = await world();
    await w.addEntry(w.alice.agent, "2026-09-10", 60);
    await w.addEntry(w.alice.agent, "2026-08-10", 60);
    const aug = (
      await w.s.json<Timesheet>("POST", "/api/timesheets/submit", {
        as: w.alice.agent,
        body: { date: "2026-08-10" },
      })
    ).body;
    await w.s.json("POST", `/api/timesheets/${aug.id}/approve`, { as: w.mgr.agent, body: {} });
    await w.s.json("PATCH", `/api/projects/${w.project.id}`, { as: w.admin, body: { rate: 150000 } });

    const dry = await w.s.json<{
      matched: number;
      changed: number;
      skippedLocked: number;
      amountBefore: number;
      amountAfter: number;
    }>("POST", "/api/admin/rerate", { as: w.admin, body: { from: "2026-08-01", to: "2026-09-30" } });
    expect(dry.body).toMatchObject({
      matched: 2,
      changed: 1,
      skippedLocked: 1,
      amountBefore: 100000,
      amountAfter: 150000,
    });
    let rates = w.s.ctx.db
      .query<{ r: number }, []>("SELECT rate_snapshot AS r FROM time_entries ORDER BY entry_date")
      .all();
    expect(rates.map((x) => x.r)).toEqual([100000, 100000]);

    await w.s.json("POST", "/api/admin/rerate", {
      as: w.admin,
      body: { from: "2026-08-01", to: "2026-09-30", dryRun: false, reason: "New 2026 rates" },
    });
    rates = w.s.ctx.db
      .query<{ r: number }, []>("SELECT rate_snapshot AS r FROM time_entries ORDER BY entry_date")
      .all();
    expect(rates.map((x) => x.r)).toEqual([100000, 150000]);
    const log = await w.s.json<{ rows: { action: string; reason: string }[] }>(
      "GET",
      "/api/admin/audit?action=rerate",
      { as: w.admin },
    );
    expect(log.body.rows[0]!.reason).toBe("New 2026 rates");
    expect(
      (
        await w.s.json("POST", "/api/admin/rerate", {
          as: w.mgr.agent,
          body: { from: "2026-08-01", to: "2026-09-30" },
        })
      ).status,
    ).toBe(403);
  });
});
