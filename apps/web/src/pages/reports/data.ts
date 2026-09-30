import {
  addDays,
  endOfMonth,
  localDate,
  parseIsoDate,
  type ReportData,
  startOfMonth,
  startOfWeek,
} from "@stint/shared";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import { useData } from "../../data/DataProvider.tsx";
import { useSettings } from "../../tracking/hooks.ts";

/** Everything reports need, straight from the local copy (so reports work offline too). */
export function useReportData(): ReportData | null {
  const { db } = useData();
  const settings = useSettings();
  const raw = useLiveQuery(async () => {
    const [entries, projects, clients, tasks, users, tags] = await Promise.all([
      db.timeEntries.toArray(),
      db.projects.toArray(),
      db.clients.toArray(),
      db.tasks.toArray(),
      db.users.toArray(),
      db.tags.toArray(),
    ]);
    return { entries, projects, clients, tasks, users, tags };
  }, [db]);
  return useMemo(() => (raw ? { ...raw, settings } : null), [raw, settings]);
}

export type Preset =
  | "this-week"
  | "last-week"
  | "this-month"
  | "last-month"
  | "this-quarter"
  | "this-year"
  | "last-year"
  | "custom";

export function presetRange(p: Preset, today: string, weekStart: number): { from: string; to: string } {
  const { y, m } = parseIsoDate(today);
  switch (p) {
    case "this-week": {
      const from = startOfWeek(today, weekStart);
      return { from, to: addDays(from, 6) };
    }
    case "last-week": {
      const from = addDays(startOfWeek(today, weekStart), -7);
      return { from, to: addDays(from, 6) };
    }
    case "this-month":
      return { from: startOfMonth(today), to: endOfMonth(today) };
    case "last-month": {
      const prev = addDays(startOfMonth(today), -1);
      return { from: startOfMonth(prev), to: endOfMonth(prev) };
    }
    case "this-quarter": {
      const qm = Math.floor((m - 1) / 3) * 3 + 1;
      const from = `${y}-${String(qm).padStart(2, "0")}-01`;
      return { from, to: endOfMonth(`${y}-${String(qm + 2).padStart(2, "0")}-01`) };
    }
    case "this-year":
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    case "last-year":
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    case "custom":
      return { from: startOfMonth(today), to: endOfMonth(today) };
  }
}

export function useToday(): string {
  const s = useSettings();
  return localDate(Date.now(), s.timezone);
}
