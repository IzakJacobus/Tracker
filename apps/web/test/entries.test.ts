import "fake-indexeddb/auto";
import { HlcClock, type TimeEntry } from "@stint/shared";
import { afterEach, describe, expect, test } from "vitest";
import { StintDB } from "../src/data/db.ts";
import { EntryRepo, nextFreeStart, planCellChange } from "../src/data/entries.ts";
import { SyncEngine } from "../src/data/syncEngine.ts";
import { setTransport } from "../src/lib/api.ts";
import { NetworkError, type Transport } from "../src/lib/transport.ts";

let n = 0;
function setup() {
  const db = new StintDB(`entries-${++n}`);
  let now = Date.UTC(2026, 8, 29, 7, 0);
  const clock = new HlcClock("dev1", () => now);
  const repo = new EntryRepo({
    db,
    clock,
    userId: "u1",
    timezone: "Africa/Johannesburg",
    currency: "ZAR",
    now: () => now,
  });
  return { db, repo, clock, advance: (ms: number) => (now += ms), getNow: () => now };
}

const transport = (
  fn: (method: string, path: string, body: unknown) => { status: number; body: unknown },
): Transport => ({
  kind: "browser",
  request: async (m, p, b) => fn(m, p, b),
});
const emptyPull = { changes: {}, organization: null, cursor: 0, hasMore: false, epoch: "0.0", serverTime: 0 };

afterEach(() => setTransport(transport(() => ({ status: 500, body: null }))));

describe("EntryRepo (optimistic, offline-first)", () => {
  test("create writes locally and queues exactly one change", async () => {
    const { db, repo } = setup();
    await db.projects.put({ id: "p1", billableDefault: true } as never);
    const e = await repo.create({
      projectId: "p1",
      startedAt: Date.UTC(2026, 8, 29, 22, 30),
      durationS: 1800,
      description: "Late call",
    });
    expect(await db.timeEntries.get(e.id)).toMatchObject({
      description: "Late call",
      entryDate: "2026-09-30",
      billable: true,
    });
    const out = await db.outbox.toArray();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ op: "create", table: "timeEntries", id: e.id });
    expect(out[0]!.patch).not.toHaveProperty("rateSnapshot");
    expect(out[0]!.patch).not.toHaveProperty("userId");
  });

  test("billable defaults come from the task, then the project", async () => {
    const { db, repo } = setup();
    await db.projects.put({ id: "p1", billableDefault: true } as never);
    await db.tasks.put({ id: "t1", projectId: "p1", billable: false } as never);
    const e = await repo.create({ projectId: "p1", taskId: "t1", startedAt: Date.now(), durationS: 60 });
    expect(e.billable).toBe(false);
  });

  test("start stops the running timer at the new start time", async () => {
    const { db, repo, advance } = setup();
    await db.projects.put({ id: "p1", billableDefault: true } as never);
    const a = await repo.start({ projectId: "p1" });
    advance(25 * 60_000);
    const b = await repo.start({ projectId: "p1", description: "next" });
    expect((await db.timeEntries.get(a.id))!.durationS).toBe(1500);
    expect((await db.timeEntries.get(b.id))!.durationS).toBeNull();
    expect((await repo.running())!.id).toBe(b.id);
  });

  test("stop caps runaway timers at 24 hours", async () => {
    const { db, repo, advance } = setup();
    await db.projects.put({ id: "p1", billableDefault: true } as never);
    const a = await repo.start({ projectId: "p1" });
    advance(3 * 86_400_000);
    await repo.stop();
    expect((await db.timeEntries.get(a.id))!.durationS).toBe(86_400);
  });

  test("continue starts a new timer with the same details; duplicate copies after the original", async () => {
    const { db, repo } = setup();
    await db.projects.put({ id: "p1", billableDefault: true } as never);
    const e = await repo.create({
      projectId: "p1",
      startedAt: 1_800_000_000_000,
      durationS: 600,
      description: "Survey",
      tagIds: ["t"],
    });
    const c = await repo.continueEntry(e);
    expect(c).toMatchObject({ description: "Survey", durationS: null, tagIds: ["t"], source: "timer" });
    const d = await repo.duplicate(e);
    expect(d).toMatchObject({ description: "Survey", durationS: 600, startedAt: e.startedAt + 600_000 });
  });

  test("delete removes locally and queues a tombstone", async () => {
    const { db, repo } = setup();
    await db.projects.put({ id: "p1", billableDefault: true } as never);
    const e = await repo.create({ projectId: "p1", startedAt: Date.now(), durationS: 60 });
    await repo.remove(e.id);
    expect(await db.timeEntries.get(e.id)).toBeUndefined();
    expect((await db.outbox.toArray()).map((c) => c.op)).toEqual(["create", "delete"]);
  });

  test("favourites toggle on and off", async () => {
    const { db, repo } = setup();
    expect(await repo.toggleFavorite("p1", null)).toBe(true);
    expect(await db.favorites.count()).toBe(1);
    expect(await repo.toggleFavorite("p1", null)).toBe(false);
    expect(await db.favorites.count()).toBe(0);
  });
});

describe("offline edit, then sync", () => {
  test("changes made offline are kept and pushed in order when the server returns", async () => {
    const { db, repo, clock } = setup();
    await db.projects.put({ id: "p1", billableDefault: true } as never);
    const engine = new SyncEngine(db, clock);
    setTransport(
      transport(() => {
        throw new NetworkError();
      }),
    );
    const e = await repo.create({
      projectId: "p1",
      startedAt: Date.now(),
      durationS: 60,
      description: "offline",
    });
    await repo.update(e.id, { description: "offline, edited" });
    await engine.syncNow();
    expect(engine.get().state).toBe("offline");
    expect(engine.get().pending).toBe(2);

    const received: { op: string; patch: Record<string, unknown> }[] = [];
    setTransport(
      transport((_m, path, body) => {
        if (path === "/sync/push") {
          const changes = (
            body as {
              changes: { changeId: string; id: string; op: string; patch: Record<string, unknown> }[];
            }
          ).changes;
          received.push(...changes);
          return {
            status: 200,
            body: {
              serverHlc: "000001900000000:00000:server",
              results: changes.map((c) => ({
                changeId: c.changeId,
                table: "timeEntries",
                id: c.id,
                status: "accepted",
                row: { ...e, description: "offline, edited", rateSnapshot: 95000, serverSeq: 7 },
              })),
            },
          };
        }
        return { status: 200, body: emptyPull };
      }),
    );
    await engine.syncNow();
    expect(received.map((c) => c.op)).toEqual(["create", "update"]);
    expect(await db.outbox.count()).toBe(0);
    expect(await db.timeEntries.get(e.id)).toMatchObject({
      description: "offline, edited",
      rateSnapshot: 95000,
      serverSeq: 7,
    });
    expect(engine.get().state).toBe("synced");
  });

  test("a rejected change is rolled back locally and reported", async () => {
    const { db, repo, clock } = setup();
    await db.projects.put({ id: "p1", billableDefault: true } as never);
    const engine = new SyncEngine(db, clock);
    const messages: string[] = [];
    engine.onRejected = (m) => messages.push(m);
    const e = await repo.create({ projectId: "p1", startedAt: Date.now(), durationS: 60 });
    setTransport(
      transport((_m, path, body) => {
        if (path === "/sync/push") {
          const c = (body as { changes: { changeId: string; id: string }[] }).changes[0]!;
          return {
            status: 200,
            body: {
              serverHlc: "000001900000000:00000:server",
              results: [
                {
                  changeId: c.changeId,
                  table: "timeEntries",
                  id: c.id,
                  status: "rejected",
                  code: "locked",
                  message: "Locked!",
                  row: null,
                },
              ],
            },
          };
        }
        return { status: 200, body: emptyPull };
      }),
    );
    await engine.syncNow();
    expect(await db.timeEntries.get(e.id)).toBeUndefined();
    expect(messages).toEqual(["Locked!"]);
    expect(engine.get().rejected[0]!.message).toBe("Locked!");
  });
});

describe("grid and placement helpers", () => {
  const entry = (
    id: string,
    startedAt: number,
    durationS: number | null,
    source: TimeEntry["source"] = "timer",
  ) => ({ id, startedAt, durationS, source }) as TimeEntry;

  test("an empty cell gets one new entry", () => {
    expect(planCellChange([], 7200)).toEqual({ updates: [], deletes: [], add: 7200 });
  });
  test("increasing grows the existing grid entry", () => {
    expect(planCellChange([entry("a", 1, 3600, "grid")], 5400)).toEqual({
      updates: [{ id: "a", durationS: 5400 }],
      deletes: [],
      add: 0,
    });
  });
  test("increasing a timer-only cell adds a grid entry for the difference", () => {
    expect(planCellChange([entry("a", 1, 3600)], 5400)).toEqual({ updates: [], deletes: [], add: 1800 });
  });
  test("decreasing shrinks the most recent entries first and deletes emptied ones", () => {
    const cell = [entry("early", 1, 3600), entry("late", 2, 1800)];
    expect(planCellChange(cell, 3000)).toEqual({
      updates: [{ id: "early", durationS: 3000 }],
      deletes: ["late"],
      add: 0,
    });
  });
  test("clearing a cell deletes everything in it", () => {
    expect(planCellChange([entry("a", 1, 60), entry("b", 2, 60)], 0).deletes.sort()).toEqual(["a", "b"]);
  });
  test("duration-only entries are placed after the day's other entries", () => {
    const day = "2026-09-29";
    const nine = Date.UTC(2026, 8, 29, 6, 0); // 08:00 SAST
    expect(nextFreeStart([], day, "08:00", "Africa/Johannesburg")).toBe(nine);
    expect(nextFreeStart([entry("a", nine, 3600)], day, "08:00", "Africa/Johannesburg")).toBe(
      nine + 3_600_000,
    );
  });
});
