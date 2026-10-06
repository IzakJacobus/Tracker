import { describe, expect, test } from "bun:test";
import {
  importStartTimes,
  parseCsv,
  parseImportDate,
  parseImportDuration,
  parseImportTime,
  readImportCsv,
} from "../src/csvImport.ts";
import { toCsv } from "../src/export/csv.ts";

const TZ = "Africa/Johannesburg";

describe("parseCsv", () => {
  test("handles quotes, embedded commas and newlines, CRLF and a BOM", () => {
    const text = '﻿a,b,c\r\n1,"two, too","line\nbreak"\r\n"say ""hi""",,x\r\n';
    expect(parseCsv(text)).toEqual([
      ["a", "b", "c"],
      ["1", "two, too", "line\nbreak"],
      ['say "hi"', "", "x"],
    ]);
  });

  test("detects semicolon-separated files and skips blank lines", () => {
    expect(parseCsv("a;b\n\n1;2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("field parsers", () => {
  test("dates: ISO and day-first", () => {
    expect(parseImportDate("2026-09-30")).toBe("2026-09-30");
    expect(parseImportDate("2026/9/3")).toBe("2026-09-03");
    expect(parseImportDate("30/09/2026")).toBe("2026-09-30");
    expect(parseImportDate("31/02/2026")).toBeNull();
    expect(parseImportDate("yesterday")).toBeNull();
  });

  test("times and durations", () => {
    expect(parseImportTime("9:05")).toBe("09:05:00");
    expect(parseImportTime("09:05:30")).toBe("09:05:30");
    expect(parseImportTime("1:15 PM")).toBe("13:15:00");
    expect(parseImportTime("25:00")).toBeNull();
    expect(parseImportDuration("01:30:00")).toBe(5400);
    expect(parseImportDuration("1:30")).toBe(5400);
    expect(parseImportDuration("1.5")).toBe(5400);
    expect(parseImportDuration("0,25")).toBe(900);
    expect(parseImportDuration("abc")).toBeNull();
  });
});

describe("readImportCsv", () => {
  test("reads a Toggl Track detailed export", () => {
    const csv = [
      "User,Email,Client,Project,Task,Description,Billable,Start date,Start time,End date,End time,Duration,Tags,Amount (USD)",
      'Aisha Patel,Aisha@Karoo.test,Drakenstein,Paarl bridge upgrade,Site visit,"Inspection, east abutment",Yes,2026-09-28,08:30:00,2026-09-28,10:00:00,01:30:00,"site, travel",',
      "Aisha Patel,aisha@karoo.test,,Admin,,Timesheets,No,2026-09-28,10:00:00,2026-09-28,10:15:00,00:15:00,,",
    ].join("\n");
    const r = readImportCsv(csv);
    expect(r.format).toBe("toggl");
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toEqual({
      line: 2,
      email: "aisha@karoo.test",
      person: "Aisha Patel",
      client: "Drakenstein",
      project: ["Paarl bridge upgrade"],
      task: "Site visit",
      description: "Inspection, east abutment",
      tags: ["site", "travel"],
      date: "2026-09-28",
      time: "08:30:00",
      durationS: 5400,
    });
    expect(r.rows[1]).toMatchObject({ client: "", project: ["Admin"], tags: [] });
  });

  test("reads Stint's own CSV export (project paths, totals row, formula guard)", () => {
    const csv = toCsv({
      columns: [
        { key: "date", header: "Date", kind: "date" },
        { key: "person", header: "Person", kind: "text" },
        { key: "client", header: "Client", kind: "text" },
        { key: "project", header: "Project", kind: "text" },
        { key: "task", header: "Task", kind: "text" },
        { key: "description", header: "Description", kind: "text" },
        { key: "tags", header: "Tags", kind: "text" },
        { key: "billable", header: "Billable", kind: "text" },
        { key: "hours", header: "Hours", kind: "hours" },
      ],
      rows: [
        {
          date: "2026-09-29",
          person: "Sipho Dlamini",
          client: "Drakenstein",
          project: "Paarl bridge upgrade › Detailed design",
          task: "",
          description: "-ve moment check",
          tags: "",
          billable: "No",
          hours: 9000,
        },
      ],
      totals: { date: "Total", hours: 9000 },
    } as never);
    const r = readImportCsv(csv);
    expect(r.format).toBe("stint");
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({
      person: "Sipho Dlamini",
      project: ["Paarl bridge upgrade", "Detailed design"],
      description: "-ve moment check",
      durationS: 9000,
      time: null,
    });
  });

  test("reports missing columns and bad rows with line numbers", () => {
    expect(readImportCsv("Date,Hours\n2026-09-01,1").errors[0]?.message).toBe(
      "Missing columns: project, person or email.",
    );
    const r = readImportCsv(
      "Date,Person,Project,Hours\n2026-13-01,A,P,1\n2026-09-01,A,P,lots\n2026-09-01,A,P,25",
    );
    expect(r.errors.map((e) => e.line)).toEqual([2, 3, 4]);
    expect(r.rows).toEqual([]);
  });
});

describe("importStartTimes", () => {
  test("keeps given times and lays date-only rows end to end from 08:00", () => {
    const base = {
      email: "",
      person: "A",
      client: "",
      project: ["P"],
      task: "",
      description: "",
      billable: null,
      tags: [],
    };
    const rows = [
      { ...base, line: 2, date: "2026-09-28", time: null, durationS: 3600 },
      { ...base, line: 3, date: "2026-09-28", time: null, durationS: 1800 },
      { ...base, line: 4, date: "2026-09-28", time: "14:00:30", durationS: 600 },
    ];
    const starts = importStartTimes(rows, (r) => r.person, TZ);
    expect(starts).toEqual([
      Date.UTC(2026, 8, 28, 6, 0),
      Date.UTC(2026, 8, 28, 7, 0),
      Date.UTC(2026, 8, 28, 12, 0, 30),
    ]);
  });
});
