import { describe, expect, test } from "bun:test";
import {
  clientSummary,
  dashboard,
  monthlyTimesheet,
  projectReport,
  type ReportData,
} from "../src/reports.ts";
import {
  type Client,
  defaultOrgSettings,
  type Project,
  type Task,
  type TimeEntry,
  type User,
} from "../src/schemas.ts";

const meta = { createdAt: 0, updatedAt: 0, deletedAt: null, serverSeq: 0 };
const user = (id: string, name: string): User => ({
  ...meta,
  id,
  email: `${id}@x.co`,
  name,
  role: "member",
  rate: null,
  weeklyCapacityMinutes: 2400,
  color: "#000000",
  active: true,
  mustChangePassword: false,
  managerId: null,
});
const client = (id: string, name: string, isInternal = false): Client => ({
  ...meta,
  id,
  name,
  code: null,
  rate: null,
  isInternal,
  notes: "",
  archivedAt: null,
});
const project = (id: string, clientId: string, parentId: string | null, name: string): Project => ({
  ...meta,
  id,
  clientId,
  parentId,
  kind: null,
  name,
  code: null,
  color: "#000000",
  billableDefault: true,
  rate: null,
  budgetMinutes: null,
  budgetAmount: null,
  visibility: "members",
  notes: "",
  sortOrder: 0,
  archivedAt: null,
});
const task = (id: string, projectId: string, name: string): Task => ({
  ...meta,
  id,
  projectId,
  name,
  rate: null,
  billable: null,
  sortOrder: 0,
  archivedAt: null,
});
let n = 0;
const entry = (
  userId: string,
  projectId: string,
  date: string,
  minutes: number,
  extra: Partial<TimeEntry> = {},
): TimeEntry => ({
  ...meta,
  id: `e${++n}`,
  userId,
  projectId,
  taskId: null,
  description: "",
  startedAt: Date.parse(`${date}T08:00:00Z`) + n,
  durationS: minutes * 60,
  entryDate: date,
  billable: true,
  rateSnapshot: 100_000,
  currency: "ZAR",
  source: "manual",
  tagIds: [],
  ...extra,
});

function data(): ReportData {
  return {
    users: [user("ana", "Ana"), user("ben", "Ben")],
    clients: [client("int", "Internal", true), client("acme", "Acme"), client("beta", "Beta")],
    projects: [
      project("bridge", "acme", null, "Bridge"),
      project("design", "acme", "bridge", "Design"),
      project("wp1", "acme", "design", "WP1"),
      project("roads", "acme", null, "Roads"),
      project("dam", "beta", null, "Dam"),
      project("leave", "int", null, "Leave"),
    ],
    tasks: [task("site", "bridge", "Site visit")],
    tags: [],
    settings: { ...defaultOrgSettings(), rounding: { mode: "up", minutes: 15 } },
    entries: [
      entry("ana", "bridge", "2026-09-01", 60, { taskId: "site" }),
      entry("ana", "design", "2026-09-01", 50),
      entry("ben", "wp1", "2026-09-02", 90, { tagIds: ["ot"] }),
      entry("ben", "roads", "2026-09-02", 30),
      entry("ana", "dam", "2026-09-03", 120),
      entry("ana", "leave", "2026-09-04", 480, { billable: false, rateSnapshot: null }),
      entry("ana", "bridge", "2026-10-01", 60), // next month
      entry("ana", "bridge", "2026-09-05", 60, { billable: false }),
      entry("ana", "bridge", "2026-09-06", 60, { durationS: null }), // running: excluded
      entry("ana", "bridge", "2026-09-07", 60, { deletedAt: 1 }), // deleted: excluded
    ],
  };
}

describe("project timesheet", () => {
  test("includes every sub-project at any depth, and nothing outside the subtree", () => {
    const r = projectReport(data(), "bridge", { from: "2026-09-01", to: "2026-09-30" });
    expect(r.total.seconds).toBe((60 + 50 + 90 + 60) * 60);
    expect(r.bySubproject.map((s) => s.path)).toEqual(["Bridge", "Bridge › Design", "Bridge › Design › WP1"]);
  });
  test("groups by person and task", () => {
    const r = projectReport(data(), "bridge", { from: "2026-09-01", to: "2026-09-30" });
    expect(r.byPerson.map((p) => [p.user?.name, p.sum.seconds / 60])).toEqual([
      ["Ana", 170],
      ["Ben", 90],
    ]);
    expect(r.byTask.find((t) => t.task?.name === "Site visit")?.sum.seconds).toBe(3600);
  });
  test("billable amounts use rounded time and the snapshotted rate", () => {
    const r = projectReport(data(), "bridge", { from: "2026-09-01", to: "2026-09-30" });
    // billable: 60 → 60, 50 → 60 (rounded up to 15), 90 → 90 ; non-billable 60 excluded from money
    expect(r.total.billableBilledSeconds / 60).toBe(210);
    expect(r.total.amount).toBe(350_000); // 3.5 h × R1000
    expect(r.total.billedSeconds / 60).toBe(270);
  });
  test("filters: date range, people, tags, billable", () => {
    const d = data();
    expect(projectReport(d, "bridge", { from: "2026-09-02", to: "2026-09-02" }).total.seconds).toBe(5400);
    expect(
      projectReport(d, "bridge", { from: "2026-09-01", to: "2026-09-30", userIds: ["ben"] }).total.seconds,
    ).toBe(5400);
    expect(
      projectReport(d, "bridge", { from: "2026-09-01", to: "2026-09-30", tagIds: ["ot"] }).total.entries,
    ).toBe(1);
    expect(
      projectReport(d, "bridge", { from: "2026-09-01", to: "2026-09-30", billable: "nonbillable" }).total
        .seconds,
    ).toBe(3600);
  });
});

describe("monthly timesheet", () => {
  const m = monthlyTimesheet(data(), "ana", "2026-09");
  test("covers every day of the month with daily totals", () => {
    expect(m.days).toHaveLength(30);
    expect(m.days[0]!.sum.seconds).toBe(110 * 60);
    expect(m.days[3]!.sum.seconds).toBe(480 * 60);
  });
  test("includes all projects: billable client work and internal work", () => {
    expect(m.byProject.map((p) => p.path)).toEqual(["Bridge", "Bridge › Design", "Dam", "Leave"]);
    expect(m.byProject.at(-1)!.internal).toBe(true);
    expect(m.internalSeconds).toBe(480 * 60);
  });
  test("totals and expected hours (working days × workday)", () => {
    expect(m.total.seconds).toBe((60 + 50 + 120 + 480 + 60) * 60);
    // September 2026 has 22 weekdays
    expect(m.expectedSeconds).toBe(22 * 8 * 3600);
  });
  test("excludes running and deleted entries and other months", () => {
    expect(
      m.lines.some((l) => l.date === "2026-09-06" || l.date === "2026-09-07" || l.date === "2026-10-01"),
    ).toBe(false);
  });
});

describe("client summary", () => {
  test("billable only, internal excluded, grouped by client and project", () => {
    const s = clientSummary(data(), { from: "2026-09-01", to: "2026-09-30" });
    expect(s.clients.map((c) => c.client?.name)).toEqual(["Acme", "Beta"]);
    const acme = s.clients[0]!;
    expect(acme.projects.map((p) => p.path)).toEqual([
      "Bridge",
      "Bridge › Design",
      "Bridge › Design › WP1",
      "Roads",
    ]);
    expect(acme.sum.billableBilledSeconds / 60).toBe(60 + 60 + 90 + 30);
    expect(s.total.amount).toBe(acme.sum.amount + s.clients[1]!.sum.amount);
  });
  test("can be limited to one client", () => {
    const s = clientSummary(data(), { from: "2026-09-01", to: "2026-09-30", clientIds: ["beta"] });
    expect(s.clients.map((c) => c.clientId)).toEqual(["beta"]);
  });
});

describe("dashboard", () => {
  test("utilisation is billable hours over capacity", () => {
    const d = data();
    const r = dashboard(d, { from: "2026-09-01", to: "2026-09-04" }, d.users);
    // 4 working days × 8 h × 2 people = 64 h capacity
    expect(r.capacitySeconds).toBe(64 * 3600);
    const billable = (60 + 50 + 90 + 30 + 120) * 60;
    expect(r.period.billableSeconds).toBe(billable);
    expect(r.utilisation).toBeCloseTo(billable / (64 * 3600));
    expect(r.topProjects[0]!.path).toBe("Leave");
    expect(r.byDay).toHaveLength(4);
  });
});
