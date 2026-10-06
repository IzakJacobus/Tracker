import type { Database } from "bun:sqlite";
import { formatHlc, MAX_ENTRY_SECONDS, type TimeEntry } from "@stint/shared";
import { getFieldClock, listRows, TABLES, updateRow } from "../db/tables.ts";
import { audit } from "../lib/audit.ts";

/**
 * Stint 0.2 has no timer: people log hours. Any timer still running from an older version is
 * closed with the time it ran (at most 24 hours), so it shows up as an ordinary entry.
 */
export function closeRunningTimers(db: Database, now: number): number {
  const running = listRows(
    db,
    TABLES.timeEntries,
    "duration_s IS NULL AND deleted_at IS NULL",
  ) as TimeEntry[];
  db.transaction(() => {
    for (const e of running) {
      const durationS = Math.max(0, Math.min(MAX_ENTRY_SECONDS, Math.round((now - e.startedAt) / 1000)));
      // A server clock on the field, so an older offline edit can't bring the timer back.
      const clock = {
        ...getFieldClock(db, TABLES.timeEntries, e.id),
        durationS: formatHlc({ ms: now, counter: 0, node: "server" }),
      };
      const after = updateRow(db, TABLES.timeEntries, e.id, { durationS }, now, clock);
      audit(db, now, {
        actorId: null,
        action: "update",
        entity: "time_entry",
        entityId: e.id,
        before: e,
        after,
        reason: "Stint no longer has a timer, so the running timer was stopped.",
      });
    }
  })();
  return running.length;
}
