import { describe, expect, test } from "bun:test";
import type { Project } from "@stint/shared";
import { createTestServer } from "./helpers.ts";

const PROJECTS = [
  "Client,Project code,Path,Type,Item code,Done,Budget hours",
  "Drakenstein,2026-014,Paarl bridge,,,,900",
  "Drakenstein,2026-014,Paarl bridge › Design,Phase,,,",
  "Drakenstein,2026-014,Paarl bridge › Design › Pier design,Task,D-01,Yes,12.5",
  "Drakenstein,2026-015,Ring road,,,,",
].join("\r\n");

const HOURS = [
  "Date,Person,Email,Client,Project code,Project,Hours,Note,Tags",
  "2026-09-28,Aisha Patel,aisha@example.co.za,Drakenstein,2026-014,Paarl bridge › Design › Pier design,2:30:00,Load combinations,",
  "2026-09-29,Aisha Patel,aisha@example.co.za,Drakenstein,2026-015,Ring road,1:00:00,Survey,",
].join("\r\n");

type Summary = {
  dryRun: boolean;
  imported: number;
  projectRows: number;
  projectsUpdated: number;
  errors: { line: number; message: string }[];
  created: { projects: string[] };
};

async function setup() {
  const t = createTestServer();
  const admin = await t.setup();
  const aisha = await t.createUser(admin, { name: "Aisha Patel", email: "aisha@example.co.za" });
  const projects = async () => (await t.json<Project[]>("GET", "/api/projects", { as: admin })).body;
  return { t, admin, aisha, projects };
}

describe("workbook import", () => {
  test("the Projects sheet creates projects and items with the file's codes, types, done state and budgets", async () => {
    const { t, admin, projects } = await setup();
    const dry = await t.json<Summary>("POST", "/api/admin/import", {
      as: admin,
      body: { csv: "", projectsCsv: PROJECTS },
    });
    expect(dry.body).toMatchObject({ dryRun: true, projectRows: 4, projectsUpdated: 0, errors: [] });
    expect(dry.body.created.projects).toHaveLength(4);
    expect((await projects()).some((p) => p.name === "Paarl bridge")).toBe(false);

    const r = await t.json<Summary>("POST", "/api/admin/import", {
      as: admin,
      body: { csv: "", projectsCsv: PROJECTS, dryRun: false },
    });
    expect(r.body.errors).toEqual([]);
    const all = await projects();
    const byName = (n: string) => all.find((p) => p.name === n)!;
    expect(byName("Paarl bridge")).toMatchObject({ code: "2026-014", budgetMinutes: 54_000, parentId: null });
    expect(byName("Ring road").code).toBe("2026-015");
    expect(byName("Design")).toMatchObject({ kind: "Phase", parentId: byName("Paarl bridge").id });
    const pier = byName("Pier design");
    expect(pier).toMatchObject({
      kind: "Task",
      code: "D-01",
      budgetMinutes: 750,
      parentId: byName("Design").id,
    });
    expect(pier.archivedAt).not.toBeNull();
  });

  test("importing the same sheets again changes nothing; edits update in place", async () => {
    const { t, admin, projects } = await setup();
    const body = { csv: HOURS, projectsCsv: PROJECTS, dryRun: false };
    const first = await t.json<Summary>("POST", "/api/admin/import", { as: admin, body });
    expect(first.body).toMatchObject({ imported: 2, errors: [] });
    const count = (await projects()).length;

    const again = await t.json<Summary>("POST", "/api/admin/import", { as: admin, body });
    expect(again.body).toMatchObject({ imported: 0, projectsUpdated: 0, errors: [] });
    expect(again.body.created.projects).toEqual([]);
    expect((await projects()).length).toBe(count);

    // Reopen the done item and give it a bigger budget.
    const edited = PROJECTS.replace("D-01,Yes,12.5", "D-01,No,20");
    const upd = await t.json<Summary>("POST", "/api/admin/import", {
      as: admin,
      body: { csv: "", projectsCsv: edited, dryRun: false },
    });
    expect(upd.body.projectsUpdated).toBe(1);
    const pier = (await projects()).find((p) => p.name === "Pier design")!;
    expect(pier).toMatchObject({ budgetMinutes: 1200, archivedAt: null });
  });

  test("hours land on the project matched by its code, even when the file's names differ", async () => {
    const { t, admin, projects } = await setup();
    await t.json("POST", "/api/admin/import", {
      as: admin,
      body: { csv: "", projectsCsv: PROJECTS, dryRun: false },
    });
    const renamedHours = HOURS.replace("Ring road,1:00:00", "Ring road,1:00:00").replace(
      "2026-015,Ring road",
      "2026-014,Paarl bridge",
    );
    const r = await t.json<Summary>("POST", "/api/admin/import", {
      as: admin,
      body: { csv: renamedHours, dryRun: false },
    });
    expect(r.body).toMatchObject({ imported: 2, errors: [] });
    expect(r.body.created.projects).toEqual([]);
    expect((await projects()).filter((p) => p.name === "Paarl bridge")).toHaveLength(1);
  });

  test("a code another project of the client already uses is reported, not duplicated", async () => {
    const { t, admin, projects } = await setup();
    await t.json("POST", "/api/admin/import", {
      as: admin,
      body: { csv: "", projectsCsv: PROJECTS, dryRun: false },
    });
    const sheet = [
      "Client,Project code,Path,Type,Item code,Done,Budget hours",
      "Drakenstein,2026-014,Paarl bridge › Detailed design,Phase,2026-015,,",
    ].join("\r\n");
    const r = await t.json<Summary>("POST", "/api/admin/import", {
      as: admin,
      body: { csv: "", projectsCsv: sheet, dryRun: false },
    });
    expect(r.body.errors.map((e) => e.message).join()).toContain("already used");
    const created = (await projects()).find((p) => p.name === "Detailed design")!;
    expect(created.code).toBeNull();
  });

  test("a new top-level project without a code continues the client's numbering; people and rows are checked", async () => {
    const { t, admin, projects } = await setup();
    await t.json("POST", "/api/admin/import", {
      as: admin,
      body: { csv: "", projectsCsv: PROJECTS, dryRun: false },
    });
    const sheet = ["Client,Project code,Path", "Drakenstein,,Culvert repairs"].join("\r\n");
    await t.json("POST", "/api/admin/import", {
      as: admin,
      body: { csv: "", projectsCsv: sheet, dryRun: false },
    });
    expect((await projects()).find((p) => p.name === "Culvert repairs")!.code).toBe("2026-016");
    const nothing = await t.json("POST", "/api/admin/import", { as: admin, body: { csv: "" } });
    expect(nothing.status).toBe(422);
    const noPath = await t.json<Summary>("POST", "/api/admin/import", {
      as: admin,
      body: { csv: "", projectsCsv: "Client,Code\r\nX,1" },
    });
    expect(noPath.body.errors[0]?.message).toContain("Path");
  });
});
