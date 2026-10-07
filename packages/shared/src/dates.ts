/**
 * Date helpers. "Local dates" are YYYY-MM-DD strings in the organisation's
 * timezone. Instants are ms since the epoch. Only `Intl` is used, so these
 * work identically in the browser, Bun and the desktop WebView.
 */

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = dtfCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    dtfCache.set(timeZone, f);
  }
  return f;
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function zonedParts(ms: number, timeZone: string): ZonedParts {
  const out: Record<string, number> = {};
  for (const p of partsFormatter(timeZone).formatToParts(new Date(ms))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return {
    year: out.year!,
    month: out.month!,
    day: out.day!,
    hour: out.hour! % 24,
    minute: out.minute!,
    second: out.second!,
  };
}

/** Offset of `timeZone` from UTC at instant `ms`, in ms (e.g. +2h for Johannesburg). */
export function tzOffsetMs(ms: number, timeZone: string): number {
  const p = zonedParts(ms, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

export function localDate(ms: number, timeZone: string): string {
  const p = zonedParts(ms, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function localTime(ms: number, timeZone: string): string {
  const p = zonedParts(ms, timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** Converts a wall-clock time in `timeZone` to an instant. */
export function zonedToInstant(date: string, time: string, timeZone: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  // Two passes handle DST transitions correctly for real-world zones.
  let instant = guess - tzOffsetMs(guess, timeZone);
  instant = guess - tzOffsetMs(instant, timeZone);
  return instant;
}

export function parseIsoDate(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return { y, m, d };
}

export function formatIsoDate(y: number, m: number, d: number): string {
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

/** A YYYY-MM-DD date that exists on the calendar, in the years Stint accepts (2000–2099). */
export function isValidIsoDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const { y, m, d } = parseIsoDate(date);
  if (y < 2000 || y > 2099) return false;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** Calendar arithmetic on local dates (timezone-independent). */
export function addDays(date: string, days: number): string {
  const { y, m, d } = parseIsoDate(date);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return formatIsoDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** 0 = Sunday … 6 = Saturday */
export function dayOfWeek(date: string): number {
  const { y, m, d } = parseIsoDate(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function daysBetween(from: string, to: string): number {
  const a = parseIsoDate(from);
  const b = parseIsoDate(to);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
}

export function startOfWeek(date: string, weekStart: number): string {
  const diff = (dayOfWeek(date) - weekStart + 7) % 7;
  return addDays(date, -diff);
}

export function weekDates(date: string, weekStart: number): string[] {
  const start = startOfWeek(date, weekStart);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function endOfMonth(date: string): string {
  const { y, m } = parseIsoDate(date);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return formatIsoDate(y, m, last);
}

export function dateRange(from: string, to: string): string[] {
  const n = daysBetween(from, to);
  return Array.from({ length: Math.max(0, n + 1) }, (_, i) => addDays(from, i));
}

/** How often timesheets are approved. */
export type ApprovalPeriod = "week" | "biweek" | "month";

/**
 * The approval period containing `date`. A week (or two) ends on `approvalDay` (0 = Sunday …
 * 5 = Friday, 6 = Saturday) and starts the day after the previous one. Fortnights are paired from
 * a fixed starting week, so they never shift. A month is the calendar month.
 */
export function periodFor(
  date: string,
  period: ApprovalPeriod,
  approvalDay = 5,
): { start: string; end: string } {
  if (period === "month") return { start: startOfMonth(date), end: endOfMonth(date) };
  const end = addDays(date, (approvalDay - dayOfWeek(date) + 7) % 7);
  if (period === "week") return { start: addDays(end, -6), end };
  const weeks = Math.floor(daysBetween("2000-01-03", end) / 7);
  return weeks % 2 === 0
    ? { start: addDays(end, -13), end }
    : { start: addDays(end, -6), end: addDays(end, 7) };
}

export function isWithin(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDate(
  date: string,
  format: "YYYY-MM-DD" | "DD/MM/YYYY" | "MM/DD/YYYY" | "D MMM YYYY",
): string {
  const { y, m, d } = parseIsoDate(date);
  switch (format) {
    case "YYYY-MM-DD":
      return date;
    case "DD/MM/YYYY":
      return `${pad(d)}/${pad(m)}/${y}`;
    case "MM/DD/YYYY":
      return `${pad(m)}/${pad(d)}/${y}`;
    case "D MMM YYYY":
      return `${d} ${MONTHS[m - 1]} ${y}`;
  }
}

export function monthName(month: number): string {
  return [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ][month - 1]!;
}

/** Formats seconds as H:MM (e.g. 5400 → "1:30"). */
export function formatDuration(seconds: number, withSeconds = false): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return withSeconds ? `${h}:${pad(m)}:${pad(sec)}` : `${h}:${pad(m)}`;
}

/** Decimal hours, 2 dp (e.g. 5400 → 1.5). */
export function toHours(seconds: number): number {
  return Math.round((seconds / 3600) * 100) / 100;
}

/**
 * Parses what people type into a duration field: "1:30", "1h30", "1.5", "90m",
 * "1h", "45". Plain integers ≤ 12 are hours, larger are minutes. Returns seconds.
 */
export function parseDurationInput(input: string): number | null {
  const s = input.trim().toLowerCase().replace(",", ".");
  if (s === "") return null;
  let m = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/.exec(s);
  if (m) {
    // "1:75" is a typo, not 2:15.
    if (Number(m[2]) > 59 || Number(m[3] ?? 0) > 59) return null;
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0);
  }
  m = /^(\d+(?:\.\d+)?)\s*h(?:\s*(\d+)\s*(?:m|min)?)?$/.exec(s);
  if (m) {
    if (Number(m[2] ?? 0) > 59) return null;
    return Math.round(Number(m[1]) * 3600) + Number(m[2] ?? 0) * 60;
  }
  m = /^(\d+)\s*m(?:in)?$/.exec(s);
  if (m) return Number(m[1]) * 60;
  m = /^(\d+(?:\.\d+)?)$/.exec(s);
  if (m) {
    const n = Number(m[1]);
    if (s.includes(".") || n <= 12) return Math.round(n * 3600);
    return n * 60;
  }
  return null;
}

/** Parses "9", "930", "09:30", "9:30pm" into HH:MM. */
export function parseTimeInput(input: string): string | null {
  const s = input.trim().toLowerCase();
  const m = /^(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (m[3] === "pm" && h < 12) h += 12;
  if (m[3] === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${pad(h)}:${pad(min)}`;
}
