import { strFromU8, unzipSync } from "fflate";

/**
 * Reads .xlsx files without a spreadsheet library: an .xlsx is a zip of XML files. Handles
 * shared and inline strings, numbers, booleans, and Excel's date and time formats (dates are
 * stored as day numbers, and a time like 1:30 as 0.0625 of a day). Formulas are read as the value
 * Excel last calculated.
 */
export interface XlsxSheet {
  name: string;
  /** Rows of cell texts, columns filled up with "" so every row is as wide as the sheet. */
  rows: string[][];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

const attr = (tag: string, name: string): string | undefined =>
  new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];

/** The text inside every <t> of a string item (rich text splits it over several runs). */
function textOf(xml: string): string {
  let out = "";
  for (const m of xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g)) out += decode(m[1] ?? "");
  return out;
}

function colIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const BUILTIN_DATE = new Set([
  14, 15, 16, 17, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 50, 51, 52, 53, 54, 55, 56, 57, 58,
]);
const BUILTIN_TIME = new Set([18, 19, 20, 21, 45, 46, 47]);

type CellFormat = "general" | "date" | "time";

function classifyFormat(code: string): CellFormat {
  const stripped = code
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .replace(/\[(?!h+\]|m+\]|s+\])[^\]]*\]/gi, "");
  if (/[yd]/i.test(stripped)) return "date";
  if (/h|s|\[m+\]/i.test(stripped)) return "time";
  return "general";
}

/** Cell style index → how its number should be read. */
function readFormats(stylesXml: string | undefined): CellFormat[] {
  if (!stylesXml) return [];
  const custom = new Map<number, string>();
  for (const m of stylesXml.matchAll(/<numFmt\b([^>]*)\/?>/g)) {
    const id = Number(attr(m[1]!, "numFmtId"));
    const code = attr(m[1]!, "formatCode");
    if (Number.isFinite(id) && code !== undefined) custom.set(id, decode(code));
  }
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? "";
  const out: CellFormat[] = [];
  for (const m of xfs.matchAll(/<xf\b([^>]*?)(?:\/>|>[\s\S]*?<\/xf>)/g)) {
    const id = Number(attr(m[1]!, "numFmtId") ?? 0);
    const custom_ = custom.get(id);
    out.push(
      custom_ !== undefined
        ? classifyFormat(custom_)
        : BUILTIN_DATE.has(id)
          ? "date"
          : BUILTIN_TIME.has(id)
            ? "time"
            : "general",
    );
  }
  return out;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** Excel day number → "YYYY-MM-DD" (1900 date system). */
export function excelDateToIso(serial: number): string {
  const ms = Date.UTC(1899, 11, 30) + Math.floor(serial + 1e-9) * 86_400_000;
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** A time (or duration) as a fraction of a day → "H:MM:SS". */
export function excelTimeToClock(fraction: number): string {
  const total = Math.round(fraction * 86_400);
  return `${Math.floor(total / 3600)}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

const numberText = (n: number) => String(Number(n.toPrecision(12)));

function cellText(tag: string, inner: string, strings: string[], formats: CellFormat[]): string {
  const t = attr(tag, "t");
  const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1];
  if (t === "inlineStr") return textOf(/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(inner)?.[1] ?? "");
  if (v === undefined) return "";
  if (t === "s") return strings[Number(v)] ?? "";
  if (t === "str") return decode(v);
  if (t === "b") return v === "1" ? "TRUE" : "FALSE";
  if (t === "e") return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return decode(v);
  const format = formats[Number(attr(tag, "s") ?? 0)] ?? "general";
  if (format === "date") return excelDateToIso(n);
  if (format === "time") return excelTimeToClock(n);
  return numberText(n);
}

function readSheet(xml: string, strings: string[], formats: CellFormat[]): string[][] {
  const rows: string[][] = [];
  let width = 0;
  for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowIndex = Number(attr(rm[1]!, "r") ?? rows.length + 1) - 1;
    const cells: string[] = [];
    let next = 0;
    for (const cm of (rm[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(cm[1]!, "r");
      const col = ref ? colIndex(ref) : next;
      cells[col] = cellText(cm[1]!, cm[2] ?? "", strings, formats);
      next = col + 1;
    }
    rows[rowIndex] = Array.from(cells, (c) => c ?? "");
    width = Math.max(width, cells.length);
  }
  return Array.from(rows, (r) => Array.from({ length: width }, (_, i) => r?.[i] ?? ""));
}

/** Every sheet of a workbook, as rows of text. Throws a plain-language error for other files. */
export function readXlsx(bytes: Uint8Array): XlsxSheet[] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error("This doesn't look like an Excel (.xlsx) file.");
  }
  const text = (path: string) => (files[path] ? strFromU8(files[path]!) : undefined);
  const workbook = text("xl/workbook.xml");
  if (!workbook) throw new Error("This doesn't look like an Excel (.xlsx) file.");
  const rels = text("xl/_rels/workbook.xml.rels") ?? "";
  const target = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = attr(m[1]!, "Id");
    const to = attr(m[1]!, "Target");
    if (id && to) target.set(id, to.startsWith("/") ? to.slice(1) : `xl/${to}`);
  }
  const sharedXml = text("xl/sharedStrings.xml") ?? "";
  const strings = [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)].map((m) =>
    textOf(m[1] ?? ""),
  );
  const formats = readFormats(text("xl/styles.xml"));
  const sheets: XlsxSheet[] = [];
  for (const m of workbook.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = decode(attr(m[1]!, "name") ?? "Sheet");
    const rid = /\br:id="([^"]*)"/.exec(m[1]!)?.[1] ?? attr(m[1]!, "id");
    const path = (rid && target.get(rid)) || `xl/worksheets/sheet${sheets.length + 1}.xml`;
    const xml = text(path);
    if (xml) sheets.push({ name, rows: readSheet(xml, strings, formats) });
  }
  return sheets;
}

/** Rows → CSV text (comma-separated, quoted where needed), for the importers. */
export function rowsToCsv(rows: string[][]): string {
  const cell = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return rows.map((r) => r.map(cell).join(",")).join("\r\n");
}
