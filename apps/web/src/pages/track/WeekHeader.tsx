import { addDays, dayOfWeek, formatDuration, localDate, parseIsoDate, type TimeEntry } from "@stint/shared";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useNow, useSettings } from "../../tracking/hooks.ts";
import { Button } from "../../ui/Button.tsx";

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function entrySeconds(e: TimeEntry, now: number): number {
  return e.durationS ?? Math.max(0, Math.floor((now - e.startedAt) / 1000));
}

export function rangeLabel(from: string, to: string): string {
  const a = parseIsoDate(from);
  const b = parseIsoDate(to);
  if (a.y === b.y && a.m === b.m) return `${a.d} – ${b.d} ${MONTH[b.m - 1]} ${b.y}`;
  if (a.y === b.y) return `${a.d} ${MONTH[a.m - 1]} – ${b.d} ${MONTH[b.m - 1]} ${b.y}`;
  return `${a.d} ${MONTH[a.m - 1]} ${a.y} – ${b.d} ${MONTH[b.m - 1]} ${b.y}`;
}

export function WeekHeader({
  days,
  entries,
  selected,
  onSelect,
  onShift,
  onToday,
}: {
  days: string[];
  entries: TimeEntry[];
  selected: string;
  onSelect: (d: string) => void;
  onShift: (weeks: number) => void;
  onToday: () => void;
}) {
  const settings = useSettings();
  const now = useNow(30_000);
  const today = localDate(now, settings.timezone);
  const byDay = new Map<string, number>();
  for (const e of entries) byDay.set(e.entryDate, (byDay.get(e.entryDate) ?? 0) + entrySeconds(e, now));
  const total = [...byDay.values()].reduce((a, b) => a + b, 0);
  const expected =
    days.filter((d) => settings.workingDays.includes(dayOfWeek(d))).length * settings.workdayMinutes * 60;

  return (
    <div className="week-head">
      <div className="row row--between row--wrap">
        <div className="row">
          <Button
            iconOnly
            variant="ghost"
            label="Previous week"
            icon={<ChevronLeft />}
            onClick={() => onShift(-1)}
          />
          <Button
            iconOnly
            variant="ghost"
            label="Next week"
            icon={<ChevronRight />}
            onClick={() => onShift(1)}
          />
          <h2 className="week-head__range">{rangeLabel(days[0]!, days[6]!)}</h2>
          {!days.includes(today) && (
            <Button size="sm" onClick={onToday}>
              This week
            </Button>
          )}
        </div>
        <div className="week-head__total">
          <span className="mono">{formatDuration(total)}</span>
          <span className="subtle"> / {formatDuration(expected)} h this week</span>
        </div>
      </div>
      <div className="week-strip" role="tablist" aria-label="Days">
        {days.map((d) => {
          const secs = byDay.get(d) ?? 0;
          const working = settings.workingDays.includes(dayOfWeek(d));
          const target = working ? settings.workdayMinutes * 60 : 0;
          const pct = target ? Math.min(1, secs / target) : secs ? 1 : 0;
          const short = working && d < today && secs < settings.reminders.minMinutes * 60;
          return (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={d === selected}
              className="week-strip__day"
              data-today={d === today || undefined}
              data-weekend={!working || undefined}
              onClick={() => onSelect(d)}
            >
              <span className="week-strip__name">
                {DAY[dayOfWeek(d)]} <span className="subtle">{parseIsoDate(d).d}</span>
              </span>
              <span className="week-strip__hours mono" data-short={short || undefined}>
                {secs ? formatDuration(secs) : "–"}
              </span>
              <span className="week-strip__bar" aria-hidden="true">
                <span style={{ width: `${pct * 100}%` }} />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function shiftWeek(anchor: string, weeks: number): string {
  return addDays(anchor, weeks * 7);
}
