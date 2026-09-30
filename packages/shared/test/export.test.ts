import { describe, expect, test } from "bun:test";
import { strFromU8, unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { monthlyTimesheetDoc, toCsv, toPdf, toXlsx } from "../src/export/index.ts";
import type { ExportTable } from "../src/export/model.ts";
import { monthlyTimesheet } from "../src/reports.ts";
import { defaultOrgSettings, type Organization } from "../src/schemas.ts";

const table: ExportTable = {
  columns: [
    { key: "name", header: "Name", kind: "text" },
    { key: "hours", header: "Hours", kind: "hours" },
    { key: "amount", header: "Amount", kind: "money" },
  ],
  rows: [
    { name: 'Sipho "Sparky" Dlamini', hours: 5400, amount: 142_500 },
    { name: "=HYPERLINK(evil)", hours: 60, amount: null },
    { name: "Zoë, Ødegaard", hours: 0, amount: 0 },
  ],
  totals: { name: "Total", hours: 5460, amount: 142_500 },
};

const org: Organization = {
  id: "org",
  name: "Karoo Consulting Engineers",
  settings: {
    ...defaultOrgSettings(),
    pdf: { ...defaultOrgSettings().pdf, address: "1 Main Rd\nStellenbosch" },
  },
  logo: null,
  updatedAt: 0,
  serverSeq: 0,
};

describe("CSV", () => {
  const csv = toCsv(table);
  test("starts with a BOM and uses CRLF", () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.split("\r\n")[0]).toBe("﻿Name,Hours,Amount");
  });
  test("quotes and escapes, decimal hours, major-unit money", () => {
    expect(csv).toContain('"Sipho ""Sparky"" Dlamini",1.50,1425.00');
    expect(csv).toContain('"Zoë, Ødegaard",0.00,0.00');
  });
  test("neutralises spreadsheet formulas", () => {
    expect(csv).toContain(`"'=HYPERLINK(evil)"`);
  });
  test("includes totals", () => {
    expect(csv).toContain("Total,1.52,1425.00");
  });
});

describe("XLSX", () => {
  const bytes = toXlsx([
    { name: "Entries", table, heading: ["Karoo Consulting Engineers", "September 2026"] },
  ]);
  const files = unzipSync(bytes);
  test("is a valid OOXML package", () => {
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining([
        "[Content_Types].xml",
        "_rels/.rels",
        "xl/workbook.xml",
        "xl/styles.xml",
        "xl/worksheets/sheet1.xml",
      ]),
    );
  });
  test("stores numbers as numbers and escapes text", () => {
    const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]!);
    expect(sheet).toContain("<v>1.5</v>");
    expect(sheet).toContain("<v>1425</v>");
    expect(sheet).toContain("Sipho &quot;Sparky&quot; Dlamini");
    expect(sheet).toContain('<autoFilter ref="A4:C7"/>');
  });
});

describe("PDF", () => {
  test("renders a monthly timesheet with a signature line", async () => {
    const m = monthlyTimesheet(
      {
        entries: [],
        projects: [],
        clients: [],
        tasks: [],
        users: [],
        tags: [],
        settings: org.settings,
      },
      "nobody",
      "2026-09",
    );
    const doc = monthlyTimesheetDoc(m, { organization: org, showMoney: false, generatedAt: 0 });
    const bytes = await toPdf(doc);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(parsed.getTitle()).toBe("Monthly timesheet");
  });

  test("survives characters outside the PDF standard font set and long tables", async () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({
      name: `Ngubane ✓ 日本 row ${i}`,
      hours: 3600,
      amount: 1000,
    }));
    const bytes = await toPdf({
      title: "Stress",
      meta: [],
      tables: [{ ...table, rows }],
      currency: "ZAR",
      organization: {
        name: "Org",
        logo: null,
        address: "",
        registration: "",
        vatNumber: "",
        footer: "Confidential",
        accentColor: "#1f5c4a",
      },
      generatedAt: 0,
    });
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBeGreaterThan(2);
  });

  test("embeds a PNG logo", async () => {
    // 1×1 PNG
    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const bytes = await toPdf({
      title: "Logo",
      meta: [],
      tables: [],
      currency: "ZAR",
      organization: {
        name: "Org",
        logo: png,
        address: "",
        registration: "",
        vatNumber: "",
        footer: "",
        accentColor: "#1f5c4a",
      },
      generatedAt: 0,
    });
    expect(bytes.length).toBeGreaterThan(500);
  });
});
