/**
 * Sync conflict rules — written BEFORE the merge engine (src/sync.ts).
 *
 *  1. Field-level last-write-wins by hybrid logical clock (HLC).
 *  2. Different fields edited on two devices: both edits survive.
 *  3. Deletes are tombstones and win: a later edit never revives a deleted row.
 *  4. Locked (submitted / approved) periods always win: changes are rejected.
 *  5. Server-owned fields (rate snapshot, owner, sequence…) can never be written by sync.
 *  6. Retries are idempotent: replaying the same change changes nothing.
 *  7. Two running timers for one person (started offline on two devices): the older one stops
 *     when the newer one started.
 */
import { describe, expect, test } from "bun:test";
import { formatHlc } from "../src/hlc.ts";
import { type IncomingChange, mergeChange, resolveRunningTimers, type StoredRow } from "../src/sync.ts";

const hlc = (ms: number, node = "devA", counter = 0) => formatHlc({ ms, counter, node });
const WRITABLE = [
  "projectId",
  "taskId",
  "description",
  "startedAt",
  "durationS",
  "billable",
  "tagIds",
] as const;

function stored(row: Record<string, unknown>, clock: Record<string, string>): StoredRow {
  return { row: { id: "e1", deletedAt: null, ...row }, fieldClock: clock };
}

function change(
  op: IncomingChange["op"],
  patch: Record<string, unknown>,
  at: string,
  id = "e1",
): IncomingChange {
  return { changeId: `${id}-${at}`, table: "timeEntries", id, op, patch, hlc: at };
}

const base = stored(
  { description: "Design review", projectId: "p1", durationS: 3600, billable: true, startedAt: 1000 },
  {
    description: hlc(100),
    projectId: hlc(100),
    durationS: hlc(100),
    billable: hlc(100),
    startedAt: hlc(100),
  },
);

describe("create", () => {
  test("inserts a new row with a clock entry per written field", () => {
    const r = mergeChange({
      existing: null,
      change: change(
        "create",
        { description: "New", projectId: "p1", startedAt: 5, durationS: 60 },
        hlc(200),
      ),
      writableFields: WRITABLE,
    });
    expect(r.kind).toBe("insert");
    if (r.kind !== "insert") return;
    expect(r.row).toMatchObject({ id: "e1", description: "New", projectId: "p1", durationS: 60 });
    expect(r.fieldClock).toEqual({
      description: hlc(200),
      projectId: hlc(200),
      startedAt: hlc(200),
      durationS: hlc(200),
    });
  });

  test("a create for an existing row (a retry) is merged like an update", () => {
    const r = mergeChange({
      existing: base,
      change: change("create", { description: "Design review" }, hlc(50)),
      writableFields: WRITABLE,
    });
    expect(r.kind).toBe("noop");
  });
});

describe("field-level last-write-wins", () => {
  test("a newer write wins", () => {
    const r = mergeChange({
      existing: base,
      change: change("update", { description: "Design review v2" }, hlc(300)),
      writableFields: WRITABLE,
    });
    expect(r).toMatchObject({
      kind: "update",
      patch: { description: "Design review v2" },
      ignoredFields: [],
    });
    if (r.kind === "update") expect(r.fieldClock.description).toBe(hlc(300));
  });

  test("an older write loses (it arrives late from an offline laptop)", () => {
    const newer = stored(base.row, { ...base.fieldClock, description: hlc(500) });
    const r = mergeChange({
      existing: newer,
      change: change("update", { description: "stale text" }, hlc(300)),
      writableFields: WRITABLE,
    });
    expect(r).toEqual({ kind: "noop", reason: "stale" });
  });

  test("edits to different fields on two devices both survive", () => {
    // Device A changes the description at t=300, device B the duration at t=250 (arrives second).
    const a = mergeChange({
      existing: base,
      change: change("update", { description: "From A" }, hlc(300, "devA")),
      writableFields: WRITABLE,
    });
    if (a.kind !== "update") throw new Error("expected update");
    const afterA = stored({ ...base.row, ...a.patch }, a.fieldClock);
    const b = mergeChange({
      existing: afterA,
      change: change("update", { durationS: 5400 }, hlc(250, "devB")),
      writableFields: WRITABLE,
    });
    expect(b).toMatchObject({ kind: "update", patch: { durationS: 5400 } });
    if (b.kind !== "update") return;
    const final = { ...afterA.row, ...b.patch };
    expect(final.description).toBe("From A");
    expect(final.durationS).toBe(5400);
  });

  test("a mixed change applies the newer fields and reports the ignored ones", () => {
    const clock = { ...base.fieldClock, description: hlc(400) };
    const r = mergeChange({
      existing: stored(base.row, clock),
      change: change("update", { description: "old", billable: false }, hlc(300)),
      writableFields: WRITABLE,
    });
    expect(r).toMatchObject({ kind: "update", patch: { billable: false }, ignoredFields: ["description"] });
  });

  test("equal timestamps are broken by device id, deterministically", () => {
    const clock = { ...base.fieldClock, description: hlc(300, "devB") };
    const fromA = mergeChange({
      existing: stored(base.row, clock),
      change: change("update", { description: "A" }, hlc(300, "devA")),
      writableFields: WRITABLE,
    });
    const fromC = mergeChange({
      existing: stored(base.row, clock),
      change: change("update", { description: "C" }, hlc(300, "devC")),
      writableFields: WRITABLE,
    });
    expect(fromA.kind).toBe("noop");
    expect(fromC.kind).toBe("update");
  });

  test("replaying the same change is idempotent", () => {
    const c = change("update", { description: "Once" }, hlc(300));
    const first = mergeChange({ existing: base, change: c, writableFields: WRITABLE });
    if (first.kind !== "update") throw new Error("expected update");
    const again = mergeChange({
      existing: stored({ ...base.row, ...first.patch }, first.fieldClock),
      change: c,
      writableFields: WRITABLE,
    });
    expect(again).toEqual({ kind: "noop", reason: "stale" });
  });
});

describe("tombstones", () => {
  test("delete sets deletedAt", () => {
    const r = mergeChange({
      existing: base,
      change: change("delete", {}, hlc(300)),
      writableFields: WRITABLE,
      now: 9999,
    });
    expect(r).toMatchObject({ kind: "update", patch: { deletedAt: 9999 } });
  });

  test("delete wins over a later edit: deleted rows are never revived by sync", () => {
    const deleted = stored({ ...base.row, deletedAt: 9999 }, { ...base.fieldClock, deletedAt: hlc(300) });
    const r = mergeChange({
      existing: deleted,
      change: change("update", { description: "revive?" }, hlc(900)),
      writableFields: WRITABLE,
    });
    expect(r).toEqual({ kind: "noop", reason: "deleted" });
  });

  test("deleting twice is a no-op", () => {
    const deleted = stored({ ...base.row, deletedAt: 9999 }, base.fieldClock);
    const r = mergeChange({
      existing: deleted,
      change: change("delete", {}, hlc(900)),
      writableFields: WRITABLE,
    });
    expect(r).toEqual({ kind: "noop", reason: "deleted" });
  });

  test("an update for a row that doesn't exist is rejected", () => {
    const r = mergeChange({
      existing: null,
      change: change("update", { description: "?" }, hlc(300)),
      writableFields: WRITABLE,
    });
    expect(r).toMatchObject({ kind: "reject", code: "not_found" });
  });

  test("deleting a row the server never saw is a harmless no-op", () => {
    const r = mergeChange({
      existing: null,
      change: change("delete", {}, hlc(300)),
      writableFields: WRITABLE,
    });
    expect(r).toEqual({ kind: "noop", reason: "deleted" });
  });
});

describe("locked periods always win", () => {
  const isLocked = (row: Record<string, unknown>) => row.entryDate === "2026-08-15";

  test("editing an entry in an approved period is rejected", () => {
    const locked = stored({ ...base.row, entryDate: "2026-08-15" }, base.fieldClock);
    const r = mergeChange({
      existing: locked,
      change: change("update", { description: "sneaky" }, hlc(900)),
      writableFields: WRITABLE,
      isLocked,
    });
    expect(r).toMatchObject({ kind: "reject", code: "locked" });
  });

  test("deleting an entry in an approved period is rejected", () => {
    const locked = stored({ ...base.row, entryDate: "2026-08-15" }, base.fieldClock);
    expect(
      mergeChange({
        existing: locked,
        change: change("delete", {}, hlc(900)),
        writableFields: WRITABLE,
        isLocked,
      }).kind,
    ).toBe("reject");
  });

  test("moving an entry INTO a locked period is rejected", () => {
    const open = stored({ ...base.row, entryDate: "2026-09-01" }, base.fieldClock);
    const r = mergeChange({
      existing: open,
      change: change("update", { startedAt: 1 }, hlc(900)),
      writableFields: WRITABLE,
      isLocked,
      derive: (row) => ({ ...row, entryDate: "2026-08-15" }),
    });
    expect(r).toMatchObject({ kind: "reject", code: "locked" });
  });

  test("creating an entry in a locked period is rejected", () => {
    const r = mergeChange({
      existing: null,
      change: change("create", { description: "late", startedAt: 1, projectId: "p1" }, hlc(900)),
      writableFields: WRITABLE,
      isLocked,
      derive: (row) => ({ ...row, entryDate: "2026-08-15" }),
    });
    expect(r).toMatchObject({ kind: "reject", code: "locked" });
  });

  test("the lock wins even if the device's clock is far ahead", () => {
    const locked = stored({ ...base.row, entryDate: "2026-08-15" }, base.fieldClock);
    const r = mergeChange({
      existing: locked,
      change: change("update", { description: "from the future" }, hlc(9e12)),
      writableFields: WRITABLE,
      isLocked,
    });
    expect(r.kind).toBe("reject");
  });
});

describe("server-owned fields", () => {
  test("rate snapshot, owner, sequence and unknown fields are stripped", () => {
    const r = mergeChange({
      existing: base,
      change: change(
        "update",
        { rateSnapshot: 1, userId: "someone-else", serverSeq: 99, hacked: true, description: "ok" },
        hlc(300),
      ),
      writableFields: WRITABLE,
    });
    expect(r.kind).toBe("update");
    if (r.kind !== "update") return;
    expect(r.patch).toEqual({ description: "ok" });
    expect(r.strippedFields.sort()).toEqual(["hacked", "rateSnapshot", "serverSeq", "userId"]);
  });

  test("a change with only forbidden fields does nothing", () => {
    const r = mergeChange({
      existing: base,
      change: change("update", { rateSnapshot: 1 }, hlc(300)),
      writableFields: WRITABLE,
    });
    expect(r).toEqual({ kind: "noop", reason: "stale" });
  });
});

describe("running timers", () => {
  test("when two timers run for one person, the older stops when the newer started", () => {
    const updates = resolveRunningTimers([
      { id: "old", startedAt: 1_000_000, durationS: null },
      { id: "new", startedAt: 1_600_000, durationS: null },
      { id: "done", startedAt: 0, durationS: 60 },
    ]);
    expect(updates).toEqual([{ id: "old", durationS: 600 }]);
  });

  test("three running timers keep only the newest", () => {
    const updates = resolveRunningTimers([
      { id: "a", startedAt: 0, durationS: null },
      { id: "b", startedAt: 60_000, durationS: null },
      { id: "c", startedAt: 120_000, durationS: null },
    ]);
    expect(updates).toEqual([
      { id: "a", durationS: 60 },
      { id: "b", durationS: 60 },
    ]);
  });

  test("durations are capped at 24 hours and never negative", () => {
    const updates = resolveRunningTimers([
      { id: "a", startedAt: 0, durationS: null },
      { id: "b", startedAt: 3 * 86_400_000, durationS: null },
    ]);
    expect(updates).toEqual([{ id: "a", durationS: 86_400 }]);
  });

  test("a single running timer is left alone", () => {
    expect(resolveRunningTimers([{ id: "a", startedAt: 0, durationS: null }])).toEqual([]);
  });
});
