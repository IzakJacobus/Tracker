import { type CellValue, decimalHours, type ExportTable } from "./model.ts";

function cell(v: CellValue): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) || /^[=+\-@]/.test(s)
    ? `"${s.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"`
    : s;
}

/**
 * RFC 4180 CSV with a UTF-8 byte-order mark (so Excel shows accented names
 * correctly). Hours are decimal hours.
 * Cells starting with = + - @ are prefixed with ' to prevent formula injection.
 */
export function toCsv(table: ExportTable): string {
  const cols = table.columns;
  const lines = [cols.map((c) => cell(c.header)).join(",")];
  const fmt = (kind: string, v: CellValue): CellValue => {
    if (typeof v !== "number") return v;
    if (kind === "hours") return decimalHours(v).toFixed(2);
    if (kind === "decimal") return v.toFixed(2);
    return v;
  };
  for (const r of table.rows) lines.push(cols.map((c) => cell(fmt(c.kind, r[c.key] ?? null))).join(","));
  if (table.totals) lines.push(cols.map((c) => cell(fmt(c.kind, table.totals![c.key] ?? null))).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}
