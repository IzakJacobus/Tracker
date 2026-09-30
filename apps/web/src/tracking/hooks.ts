import { isWithin, localTime, type TimeEntry, type Timesheet } from "@stint/shared";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState } from "react";
import { useMe } from "../app/session.tsx";
import { useData, useOrganization } from "../data/DataProvider.tsx";

const EMPTY: never[] = [];

/** Current time, re-rendering every `ms`. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function useSettings() {
  const org = useOrganization();
  const me = useMe();
  return org?.settings ?? me.organization!.settings;
}

/** The signed-in person's entries between two local dates (inclusive). */
export function useMyEntries(from: string, to: string): TimeEntry[] {
  const { db } = useData();
  const me = useMe();
  return (
    useLiveQuery(
      () =>
        db.timeEntries
          .where("[userId+entryDate]")
          .between([me.user.id, from], [me.user.id, to], true, true)
          .toArray(),
      [db, me.user.id, from, to],
    ) ?? EMPTY
  );
}

export function useRunningEntry(): TimeEntry | undefined {
  const { db } = useData();
  const me = useMe();
  return useLiveQuery(
    async () =>
      (await db.timeEntries.where("userId").equals(me.user.id).toArray())
        .filter((e) => e.durationS === null)
        .sort((a, b) => b.startedAt - a.startedAt)[0],
    [db, me.user.id],
  );
}

/** Submitted or approved periods lock the person's time. */
export function useLocks(): (date: string) => Timesheet | undefined {
  const { db } = useData();
  const me = useMe();
  const sheets =
    useLiveQuery(() => db.timesheets.where("userId").equals(me.user.id).toArray(), [db, me.user.id]) ?? EMPTY;
  return useMemo(() => {
    const locked = sheets.filter(
      (t) => (t.status === "submitted" || t.status === "approved") && !t.deletedAt,
    );
    return (date: string) => locked.find((t) => isWithin(date, t.periodStart, t.periodEnd));
  }, [sheets]);
}

export interface Combo {
  projectId: string;
  taskId: string | null;
}

/** Most recently used project/task combinations. */
export function useRecentCombos(limit = 6): Combo[] {
  const { db } = useData();
  const me = useMe();
  return (
    useLiveQuery(async () => {
      const recent = await db.timeEntries.orderBy("startedAt").reverse().limit(300).toArray();
      const seen = new Set<string>();
      const out: Combo[] = [];
      for (const e of recent) {
        if (e.userId !== me.user.id) continue;
        const k = `${e.projectId}|${e.taskId ?? ""}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ projectId: e.projectId, taskId: e.taskId });
        if (out.length >= limit) break;
      }
      return out;
    }, [db, me.user.id, limit]) ?? EMPTY
  );
}

export function useFavorites(): Combo[] {
  const { db } = useData();
  const me = useMe();
  return (
    useLiveQuery(
      async () =>
        (await db.favorites.where("userId").equals(me.user.id).toArray())
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((f) => ({ projectId: f.projectId, taskId: f.taskId ?? null })),
      [db, me.user.id],
    ) ?? EMPTY
  );
}

export function fmtClock(ms: number, timezone: string, format: "24h" | "12h"): string {
  const t = localTime(ms, timezone);
  if (format === "24h") return t;
  const [h, m] = t.split(":").map(Number) as [number, number];
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}
