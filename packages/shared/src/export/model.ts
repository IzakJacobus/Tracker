/** A small, format-neutral description of an exported document. */
export type CellKind = "text" | "hours" | "decimal" | "date" | "int";
export type CellValue = string | number | null;

export interface ExportColumn {
  key: string;
  header: string;
  kind: CellKind;
  /** relative width for PDF layout / character width for XLSX */
  width?: number;
}

export interface ExportTable {
  title?: string;
  columns: ExportColumn[];
  rows: Record<string, CellValue>[];
  totals?: Record<string, CellValue>;
}

export interface ExportDoc {
  title: string;
  subtitle?: string;
  /** label/value pairs shown under the title, e.g. Period, Employee */
  meta: [string, string][];
  /** highlighted figures, e.g. Total hours */
  figures?: [string, string][];
  tables: ExportTable[];
  /** signature lines (monthly timesheets) */
  signatures?: string[];
  notes?: string;
  organization: {
    name: string;
    logo: string | null;
    address: string;
    registration: string;
    footer: string;
    accentColor: string;
  };
  generatedAt: number;
}

/** Hours as H:MM for display. Stored values in tables are seconds for kind "hours". */
export function hm(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return m === 60 ? `${h + 1}:00` : `${h}:${String(m).padStart(2, "0")}`;
}

export const decimalHours = (seconds: number) => Math.round((seconds / 3600) * 100) / 100;

export function safeFileName(s: string): string {
  return s
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}
