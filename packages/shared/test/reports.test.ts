import { describe, expect, test } from "bun:test";
import {
  clientSummary,
  dashboard,
  monthlyTimesheet,
  projectReport,
  type ReportData,
} from "../src/reports.ts";
import { type Client, defaultOrgSettings, type Project, type TimeEntry, type User } from "../src/schemas.ts";

const meta = { createdAt: 0, updatedAt: 0, deletedAt: null, serverSeq: 0 };
const user = (id: string, name: string): User => ({
  ...meta,
  id,
  email: `${id}@x.co`,
  name,
  role: "member",
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
  budgetMinutes: null,
  visibility: "members",
  notes: "",
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
    tags: [],
    settings: defaultOrgSettings(),
    entries: [
      entry("ana", "bridge", "2026-09-01", 60),
      entry("ana", "design", "2026-09-01", 50),
      entry("ben", "wp1", "2026-09-02", 90, { tagIds: ["ot"] }),
      entry("ben", "roads", "2026-09-02", 30),
      entry("ana", "dam", "2026-09-03", 120),
      entry("ana", "leave", "2026-09-04", 480),
      entry("ana", "bridge", "2026-10-01", 60), // next month
      entry("ana", "bridge", "2026-09-05", 60),
      entry("ana", "bridge", "2026-09-06", 60, { durationS: null }), // a 0.1 timer still running: excluded
      entry("ana", "bridge", "2026-09-07", 60, { deletedAt: 1 }), // deleted: excluded
    ],
  };
}

describe("project report", () => {
  test("includes every item under the project at any depth, and nothing outside it", () => {
    const r = projectReport(data(), "bridge", { from: "2026-09-01", to: "2026-09-30" });
    expect(r.total.seconds).toBe((60 + 50 + 90 + 60) * 60);
    expect(r.byItem.map((s) => s.path)).toEqual(["Bridge", "Bridge › Design", "Bridge › Design › WP1"]);
  });
  test("groups by person", () => {
    const r = projectReport(data(), "bridge", { from: "2026-09-01", to: "2026-09-30" });
    expect(r.byPerson.map((p) => [p.user?.name, p.sum.seconds / 60])).toEqual([
      ["Ana", 170],
      ["Ben", 90],
    ]);
  });
  test("an item's report covers only what is under it", () => {
    const r = projectReport(data(), "design", { from: "2026-09-01", to: "2026-09-30" });
    expect(r.total.seconds / 60).toBe(50 + 90);
    expect(r.lines.every((l) => l.root?.id === "bridge")).toBe(true);
  });
  test("filters: date range, people, tags", () => {
    const d = data();
    expect(projectReport(d, "bridge", { from: "2026-09-02", to: "2026-09-02" }).total.seconds).toBe(5400);
    expect(
      projectReport(d, "bridge", { from: "2026-09-01", to: "2026-09-30", userIds: ["ben"] }).total.seconds,
    ).toBe(5400);
    expect(
      projectReport(d, "bridge", { from: "2026-09-01", to: "2026-09-30", tagIds: ["ot"] }).total.entries,
    ).toBe(1);
  });
  test("has no money in it", () => {
    const r = projectReport(data(), "bridge", { from: "2026-09-01", to: "2026-09-30" });
    expect(Object.keys(r.total).sort()).toEqual(["entries", "seconds"]);
  });
});

describe("monthly timesheet", () => {
  const m = monthlyTimesheet(data(), "ana", "2026-09");
  test("covers every day of the month with daily totals", () => {
    expect(m.days).toHaveLength(30);
    expect(m.days[0]!.sum.seconds).toBe(110 * 60);
    expect(m.days[3]!.sum.seconds).toBe(480 * 60);
  });
  test("includes all projects: client work and internal work", () => {
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
  test("hours per client and item, with the firm's own work last", () => {
    const s = clientSummary(data(), { from: "2026-09-01", to: "2026-09-30" });
    expect(s.clients.map((c) => c.client?.name)).toEqual(["Acme", "Beta", "Internal"]);
    const acme = s.clients[0]!;
    expect(acme.projects.map((p) => p.path)).toEqual([
      "Bridge",
      "Bridge › Design",
      "Bridge › Design › WP1",
      "Roads",
    ]);
    expect(acme.sum.seconds / 60).toBe(60 + 50 + 90 + 30 + 60);
    expect(s.total.seconds).toBe(s.clients.reduce((t, c) => t + c.sum.seconds, 0));
  });
  test("can be limited to one client", () => {
    const s = clientSummary(data(), { from: "2026-09-01", to: "2026-09-30", clientIds: ["beta"] });
    expect(s.clients.map((c) => c.clientId)).toEqual(["beta"]);
  });
});

describe("dashboard", () => {
  test("top projects, clients and items by hours; no capacity", () => {
    const d = data();
    const r = dashboard(d, { from: "2026-09-01", to: "2026-09-04" }, d.users);
    const logged = (60 + 50 + 90 + 30 + 120 + 480) * 60;
    expect(r.period.seconds).toBe(logged);
    expect(r.clientShare).toBeCloseTo((logged - 480 * 60) / logged);
    // Items roll up into their top-level project.
    expect(r.topProjects.map((p) => [p.path, p.sum.seconds / 60])).toEqual([
      ["Leave", 480],
      ["Bridge", 200],
      ["Dam", 120],
      ["Roads", 30],
    ]);
    expect(r.byClient.map((c) => c.client?.name)).toEqual(["Internal", "Acme", "Beta"]);
    // Hours on each item (the project or item the hours were logged on), biggest first.
    expect(r.byItem.map((i) => [i.path, i.sum.seconds / 60])).toEqual([
      ["Leave", 480],
      ["Dam", 120],
      ["Bridge › Design › WP1", 90],
      ["Bridge", 60],
      ["Bridge › Design", 50],
      ["Roads", 30],
    ]);
    expect(r).not.toHaveProperty("capacitySeconds");
    expect(r).not.toHaveProperty("utilisation");
  });
});
