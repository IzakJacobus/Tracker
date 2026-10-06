import { strToU8, zipSync } from "fflate";
import { type CellValue, decimalHours, type ExportColumn, type ExportTable } from "./model.ts";

/**
 * Minimal, dependency-light XLSX (Office Open XML) writer: inline strings,
 * numbers with formats (hours 0.00), bold header and totals.
 */
export interface Sheet {
  name: string;
  table: ExportTable;
  heading?: string[];
}

const esc = (s: string) =>
  s
    .replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)
    // biome-ignore lint/suspicious/noControlCharactersInRegex: XML 1.0 forbids these characters, so they must be stripped
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

function colName(i: number): string {
  let s = "";
  let n = i + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// style ids in styles.xml
const S = { text: 0, bold: 1, hours: 2, money: 3, hoursBold: 4, moneyBold: 5, title: 6, int: 7, intBold: 8 };

function cellXml(ref: string, col: ExportColumn, v: CellValue, bold: boolean): string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number") {
    if (col.kind === "hours")
      return `<c r="${ref}" s="${bold ? S.hoursBold : S.hours}"><v>${decimalHours(v)}</v></c>`;
    if (col.kind === "decimal") return `<c r="${ref}" s="${bold ? S.hoursBold : S.hours}"><v>${v}</v></c>`;
    return `<c r="${ref}" s="${bold ? S.intBold : S.int}"><v>${v}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr" s="${bold ? S.bold : S.text}"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
}

function sheetXml(sheet: Sheet): string {
  const { table } = sheet;
  const rows: string[] = [];
  let r = 1;
  for (const line of sheet.heading ?? []) {
    rows.push(
      `<row r="${r}"><c r="A${r}" t="inlineStr" s="${r === 1 ? S.title : S.text}"><is><t xml:space="preserve">${esc(line)}</t></is></c></row>`,
    );
    r++;
  }
  if (sheet.heading?.length) r++;
  const headerRow = r;
  rows.push(
    `<row r="${r}">${table.columns.map((c, i) => `<c r="${colName(i)}${r}" t="inlineStr" s="${S.bold}"><is><t>${esc(c.header)}</t></is></c>`).join("")}</row>`,
  );
  r++;
  for (const row of table.rows) {
    rows.push(
      `<row r="${r}">${table.columns.map((c, i) => cellXml(`${colName(i)}${r}`, c, row[c.key] ?? null, false)).join("")}</row>`,
    );
    r++;
  }
  if (table.totals) {
    rows.push(
      `<row r="${r}">${table.columns.map((c, i) => cellXml(`${colName(i)}${r}`, c, table.totals![c.key] ?? null, true)).join("")}</row>`,
    );
  }
  const cols = table.columns
    .map(
      (c, i) =>
        `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? (c.kind === "text" ? 28 : 12)}" customWidth="1"/>`,
    )
    .join("");
  const last = `${colName(table.columns.length - 1)}${Math.max(headerRow, r - 1)}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${cols}</cols>
<sheetData>${rows.join("")}</sheetData>
<autoFilter ref="A${headerRow}:${last}"/>
</worksheet>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="0.00"/><numFmt numFmtId="165" formatCode="#,##0.00"/></numFmts>
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="9">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="165" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="1" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
</cellXfs>
</styleSheet>`;

export function toXlsx(sheets: Sheet[]): Uint8Array {
  const used = new Set<string>();
  const names = sheets.map((s) => {
    let base = s.name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet";
    let name = base;
    let i = 2;
    while (used.has(name.toLowerCase())) name = `${base.slice(0, 28)} ${i++}`;
    used.add(name.toLowerCase());
    base = name;
    return base;
  });
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("\n")}
</Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>
</workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("\n")}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`),
    "xl/styles.xml": strToU8(STYLES),
  };
  sheets.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s));
  });
  return zipSync(files, { level: 6 });
}
