import { zonedToInstant } from "./dates.ts";
import { MAX_ENTRY_SECONDS } from "./schemas.ts";

/** RFC 4180 CSV parser. Handles quotes, embedded newlines, a BOM, and `;` or tab delimiters (Excel in some locales). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const counts = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length - 1] as const);
  const delim = counts.reduce((best, c) => (c[1] > best[1] ? c : best))[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === "") {
      quoted = true;
    } else if (ch === delim) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export type ImportFormat = "toggl" | "stint" | "generic";

export interface ImportRow {
  line: number;
  email: string;
  person: string;
  client: string;
  /** Project path from the top-level project down. */
  project: string[];
  task: string;
  description: string;
  tags: string[];
  date: string;
  /** HH:MM:SS local time, or null when the file only has dates. */
  time: string | null;
  durationS: number;
}

export interface ParsedImport {
  format: ImportFormat;
  rows: ImportRow[];
  errors: { line: number; message: string }[];
}

const ALIASES: Record<string, string[]> = {
  email: ["email", "e-mail", "user email"],
  person: ["user", "member", "person", "name", "username"],
  client: ["client", "customer"],
  project: ["project"],
  task: ["task"],
  description: ["description", "notes", "note"],
  date: ["start date", "date", "day"],
  time: ["start time", "start"],
  endTime: ["end time", "end"],
  duration: ["duration", "hours", "duration (h)", "duration (hours)"],
  tags: ["tags", "tag"],
};

const norm = (h: string) => h.trim().toLowerCase().replace(/\s+/g, " ");

function columnMap(headers: string[]): Record<string, number> {
  const n = headers.map(norm);
  const out: Record<string, number> = {};
  for (const [key, names] of Object.entries(ALIASES)) {
    const i = names.map((a) => n.indexOf(a)).find((x) => x >= 0);
    if (i !== undefined) out[key] = i;
  }
  return out;
}

export function detectFormat(headers: string[]): ImportFormat {
  const n = new Set(headers.map(norm));
  if (n.has("start date") && n.has("start time") && n.has("duration")) return "toggl";
  if (n.has("date") && n.has("person") && n.has("hours")) return "stint";
  return "generic";
}

/** "2026-09-30", "2026/09/30", or "30/09/2026" (day first: the South African convention). */
export function parseImportDate(s: string): string | null {
  const t = s.trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(t);
  if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t);
  if (m) return valid(Number(m[3]), Number(m[2]), Number(m[1]));
  return null;
}

function valid(y: number, mo: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** "09:05", "9:05:30", "9:05 PM" → "HH:MM:SS". */
export function parseImportTime(s: string): string | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(s.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const pm = m[4]?.toLowerCase();
  if (pm === "pm" && h < 12) h += 12;
  if (pm === "am" && h === 12) h = 0;
  const min = Number(m[2]);
  const sec = Number(m[3] ?? 0);
  if (h > 23 || min > 59 || sec > 59) return null;
  return [h, min, sec].map((x) => String(x).padStart(2, "0")).join(":");
}

/** "01:30:00", "1:30", "1.5", "1,5" (hours) → seconds. */
export function parseImportDuration(s: string): number | null {
  const t = s.trim();
  let m = /^(\d+):(\d{1,2})(?::(\d{1,2}))?$/.exec(t);
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0);
  m = /^(\d+(?:[.,]\d+)?)$/.exec(t);
  if (m) return Math.round(Number(m[1]!.replace(",", ".")) * 3600);
  return null;
}

/**
 * Turns an exported CSV (Toggl Track detailed report, a Stint export, or any file
 * with Date / Person / Project / Duration columns) into rows ready to match.
 */
export function readImportCsv(text: string): ParsedImport {
  const table = parseCsv(text);
  const errors: ParsedImport["errors"] = [];
  if (table.length < 2)
    return { format: "generic", rows: [], errors: [{ line: 1, message: "The file has no rows." }] };
  const headers = table[0]!;
  const format = detectFormat(headers);
  const col = columnMap(headers);
  const missing = ["date", "project", "duration"].filter((k) => col[k] === undefined);
  if (col.email === undefined && col.person === undefined) missing.push("person or email");
  if (missing.length) {
    return {
      format,
      rows: [],
      errors: [
        { line: 1, message: `Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.` },
      ],
    };
  }
  // Exports guard formula-like cells with a leading apostrophe; take it off again.
  const get = (r: string[], k: string) =>
    col[k] === undefined ? "" : (r[col[k]!] ?? "").trim().replace(/^'(?=[=+\-@])/, "");
  const rows: ImportRow[] = [];
  for (const [i, r] of table.slice(1).entries()) {
    const line = i + 2;
    // Totals rows at the bottom of an export.
    if (!get(r, "date") || /^total/i.test(get(r, "date"))) continue;
    const date = parseImportDate(get(r, "date"));
    if (!date) {
      errors.push({ line, message: `"${get(r, "date")}" isn't a date (use YYYY-MM-DD).` });
      continue;
    }
    const rawTime = get(r, "time");
    const time = rawTime ? parseImportTime(rawTime) : null;
    if (rawTime && !time) {
      errors.push({ line, message: `"${rawTime}" isn't a time.` });
      continue;
    }
    const durationS = parseImportDuration(get(r, "duration"));
    if (durationS === null) {
      errors.push({ line, message: `"${get(r, "duration")}" isn't a duration.` });
      continue;
    }
    if (durationS > MAX_ENTRY_SECONDS) {
      errors.push({ line, message: "Entries can't be longer than 24 hours." });
      continue;
    }
    const projectRaw = get(r, "project");
    const project = (format === "stint" ? projectRaw.split(" › ") : [projectRaw])
      .map((p) => p.trim())
      .filter(Boolean);
    const tagsRaw = get(r, "tags");
    rows.push({
      line,
      email: get(r, "email").toLowerCase(),
      person: get(r, "person"),
      client: get(r, "client"),
      project,
      task: get(r, "task"),
      description: get(r, "description").slice(0, 2000),
      tags: tagsRaw
        ? [
            ...new Set(
              tagsRaw
                .split(/[,;|]/)
                .map((t) => t.trim())
                .filter(Boolean),
            ),
          ].slice(0, 20)
        : [],
      date,
      time,
      durationS,
    });
  }
  return { format, rows, errors };
}

/**
 * Start instants for imported rows. Rows with a start time keep it; rows with only
 * a date are laid end to end from 08:00 so they don't overlap.
 */
export function importStartTimes(
  rows: ImportRow[],
  userOf: (r: ImportRow) => string,
  timeZone: string,
): number[] {
  const cursor = new Map<string, number>();
  return rows.map((r) => {
    if (r.time)
      return zonedToInstant(r.date, r.time.slice(0, 5), timeZone) + Number(r.time.slice(6, 8)) * 1000;
    const key = `${userOf(r)}|${r.date}`;
    const start = cursor.get(key) ?? zonedToInstant(r.date, "08:00", timeZone);
    cursor.set(key, start + r.durationS * 1000);
    return start;
  });
}
