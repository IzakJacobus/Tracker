import { describe, expect, test } from "bun:test";
import { strToU8, zipSync } from "fflate";
import {
  excelDateToIso,
  excelTimeToClock,
  exportWorkbook,
  hoursTable,
  projectsTable,
  readWorkbookParts,
  readXlsx,
  rowsToCsv,
  templateWorkbook,
  toXlsx,
} from "../src/export/index.ts";

describe("xlsx reader", () => {
  test("reads what our own writer wrote", () => {
    const bytes = toXlsx([
      {
        name: "Hours",
        table: {
          columns: [
            { key: "a", header: "Name", kind: "text" },
            { key: "b", header: "Hours", kind: "decimal" },
          ],
          rows: [
            { a: 'Pier <1> & "two"', b: 1.5 },
            { a: "x", b: null },
          ],
        },
      },
    ]);
    const [sheet] = readXlsx(bytes);
    expect(sheet?.name).toBe("Hours");
    expect(sheet?.rows).toEqual([
      ["Name", "Hours"],
      ['Pier <1> & "two"', "1.5"],
      ["x", ""],
    ]);
  });

  test("date serials and time fractions", () => {
    expect(excelDateToIso(46_023)).toBe("2026-01-01");
    expect(excelDateToIso(45_292.75)).toBe("2024-01-01");
    expect(excelTimeToClock(0.0625)).toBe("1:30:00");
    expect(excelTimeToClock(1.5)).toBe("36:00:00");
  });

  test("shared strings, date and time formats, sparse cells", () => {
    const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
    const files = {
      "xl/workbook.xml": `<workbook ${ns} xmlns:r="x"><sheets><sheet name="Log &amp; co" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
      "xl/sharedStrings.xml": `<sst ${ns}><si><t>Date</t></si><si><r><t>Ho</t></r><r><t>urs</t></r></si></sst>`,
      "xl/styles.xml": `<styleSheet ${ns}><numFmts count="1"><numFmt numFmtId="164" formatCode="[h]:mm"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs></styleSheet>`,
      "xl/worksheets/sheet1.xml": `<worksheet ${ns}><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="2"><c r="A2" s="1"><v>46023</v></c><c r="C2" s="2"><v>0.0625</v></c></row></sheetData></worksheet>`,
    };
    const bytes = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
    const [sheet] = readXlsx(bytes);
    expect(sheet?.name).toBe("Log & co");
    expect(sheet?.rows).toEqual([
      ["Date", "", "Hours"],
      ["2026-01-01", "", "1:30:00"],
    ]);
  });

  test("rejects other files in plain language", () => {
    expect(() => readXlsx(strToU8("a,b\n1,2"))).toThrow(/Excel/);
  });

  test("rowsToCsv quotes where needed", () => {
    expect(
      rowsToCsv([
        ["a,b", 'q"', "n"],
        ["1", "", "x\ny"],
      ]),
    ).toBe('"a,b","q""",n\r\n1,,"x\ny"');
  });
});

const now = 1_700_000_000_000;
const base = { createdAt: now, updatedAt: now, deletedAt: null };
const clients = [
  { id: "c1", name: "Drakenstein", code: null, isInternal: false, archivedAt: null, ...base },
  { id: "c0", name: "Internal", code: null, isInternal: true, archivedAt: null, ...base },
] as never[];
const mk = (id: string, parentId: string | null, name: string, extra: object = {}) =>
  ({
    id,
    clientId: "c1",
    parentId,
    name,
    kind: null,
    code: null,
    budgetMinutes: null,
    archivedAt: null,
    sortOrder: 0,
    ...base,
    ...extra,
  }) as never;
const projects = [
  mk("p1", null, "Paarl bridge", { code: "2026-014", budgetMinutes: 90 }),
  mk("p2", "p1", "Design", { kind: "Phase" }),
  mk("p3", "p2", "Pier design", { kind: "Task", code: "D-01", archivedAt: now }),
];
const users = [{ id: "u1", name: "Alice", email: "alice@example.com", ...base }] as never[];
const entries = [
  {
    id: "e1",
    userId: "u1",
    projectId: "p3",
    entryDate: "2026-09-28",
    startedAt: 1,
    durationS: 1200,
    description: 'Loads, "combos"',
    tagIds: [],
    ...base,
  },
] as never[];

describe("workbook", () => {
  test("tables list items under their project with the project code", () => {
    const t = projectsTable({ projects, clients });
    expect(t.rows).toEqual([
      {
        client: "Drakenstein",
        projectCode: "2026-014",
        path: "Paarl bridge",
        kind: "",
        itemCode: "",
        done: "",
        budget: 1.5,
      },
      {
        client: "Drakenstein",
        projectCode: "2026-014",
        path: "Paarl bridge › Design",
        kind: "Phase",
        itemCode: "",
        done: "",
        budget: null,
      },
      {
        client: "Drakenstein",
        projectCode: "2026-014",
        path: "Paarl bridge › Design › Pier design",
        kind: "Task",
        itemCode: "D-01",
        done: "Yes",
        budget: null,
      },
    ]);
    const h = hoursTable({ projects, clients, users, tags: [], entries });
    expect(h.rows[0]).toMatchObject({
      date: "2026-09-28",
      email: "alice@example.com",
      projectCode: "2026-014",
      project: "Paarl bridge › Design › Pier design",
      hours: 0.3333,
    });
  });

  test("export reads back as two CSVs; 20 minutes survive the round trip", () => {
    const parts = readWorkbookParts(exportWorkbook({ projects, clients, users, tags: [], entries }));
    expect(parts.projectsCsv).toContain("Client,Project code,Path,Type,Item code,Done,Budget hours");
    expect(parts.projectsCsv).toContain("Paarl bridge › Design › Pier design");
    expect(parts.hoursCsv?.split("\r\n")[1]).toContain(",0:20:00,");
    expect(parts.ignored).toEqual([]);
  });

  test("template has the example sheets and the how-to is ignored", () => {
    const parts = readWorkbookParts(templateWorkbook());
    expect(parts.projectsCsv).not.toBeNull();
    expect(parts.hoursCsv).not.toBeNull();
    expect(parts.ignored).toEqual(["How to use"]);
  });
});
