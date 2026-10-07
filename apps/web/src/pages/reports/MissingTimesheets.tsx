import { addDays, periodFor } from "@stint/shared";
import { useLiveQuery } from "dexie-react-hooks";
import { useData } from "../../data/DataProvider.tsx";
import { useUsers } from "../../data/hooks.ts";
import { useSettings } from "../../tracking/hooks.ts";
import { Avatar } from "../../ui/misc.tsx";
import { useToday } from "./data.ts";

/** Who hasn't submitted their timesheet for the last completed period. */
export function MissingTimesheets() {
  const { db } = useData();
  const settings = useSettings();
  const today = useToday();
  const users = useUsers().filter((u) => u.active);
  const current = periodFor(today, settings.approvalPeriod, settings.approvalDay);
  const last = periodFor(addDays(current.start, -1), settings.approvalPeriod, settings.approvalDay);
  const sheets =
    useLiveQuery(() => db.timesheets.where("periodStart").equals(last.start).toArray(), [db, last.start]) ??
    [];
  const done = new Set(
    sheets.filter((s) => s.status === "submitted" || s.status === "approved").map((s) => s.userId),
  );
  const missing = users.filter((u) => !done.has(u.id));
  return (
    <section className="card card__body stack">
      <h2>
        Not yet submitted{" "}
        <span className="subtle" style={{ fontWeight: 400, fontSize: "var(--text-sm)" }}>
          · {last.start} – {last.end}
        </span>
      </h2>
      {missing.length === 0 ? (
        <p className="muted">Everyone has submitted. 🎉</p>
      ) : (
        <div className="row row--wrap" style={{ gap: 12 }}>
          {missing.map((u) => (
            <span key={u.id} className="row" style={{ gap: 6 }}>
              <Avatar name={u.name} color={u.color} /> {u.name}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
