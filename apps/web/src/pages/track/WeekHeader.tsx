import {
  addDays,
  dayOfWeek,
  formatDuration,
  localDate,
  type Project,
  parseIsoDate,
  type TimeEntry,
} from "@stint/shared";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useProjects } from "../../data/hooks.ts";
import { useNow, useSettings } from "../../tracking/hooks.ts";
import { Button } from "../../ui/Button.tsx";

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function entrySeconds(e: TimeEntry, now: number): number {
  return e.durationS ?? Math.max(0, Math.floor((now - e.startedAt) / 1000));
}

/** Projects shown as their own piece of a day's bar; the rest are folded into "Other". */
const MAX_SEGMENTS = 4;
const OTHER_COLOR = "var(--stone-400)";

export interface DaySegment {
  key: string;
  label: string;
  color: string;
  seconds: number;
}

/** The top-level project a project belongs to (itself, if it has no parent). */
function rootProject(id: string, byId: Map<string, Project>): Project | undefined {
  const seen = new Set<string>();
  let p = byId.get(id);
  while (p?.parentId && byId.has(p.parentId) && !seen.has(p.id)) {
    seen.add(p.id);
    p = byId.get(p.parentId);
  }
  return p;
}

/**
 * A day's time per top-level project, largest first, in each project's own colour (the same as
 * its dot everywhere else). Sub-projects share their parent's colour, so they're counted with it:
 * one colour is always one piece. Beyond MAX_SEGMENTS the smallest are folded into "Other".
 */
export function daySegments(entries: TimeEntry[], byId: Map<string, Project>, now: number): DaySegment[] {
  const perRoot = new Map<string, DaySegment>();
  for (const e of entries) {
    const secs = entrySeconds(e, now);
    if (secs <= 0) continue;
    const root = rootProject(e.projectId, byId);
    const key = root?.id ?? e.projectId;
    const seg = perRoot.get(key) ?? {
      key,
      label: root?.name ?? "Unknown project",
      color: root?.color ?? OTHER_COLOR,
      seconds: 0,
    };
    seg.seconds += secs;
    perRoot.set(key, seg);
  }
  const all = [...perRoot.values()].sort((a, b) => b.seconds - a.seconds || a.label.localeCompare(b.label));
  if (all.length <= MAX_SEGMENTS) return all;
  const shown = all.slice(0, MAX_SEGMENTS - 1);
  const rest = all.slice(MAX_SEGMENTS - 1);
  return [
    ...shown,
    {
      key: "other",
      label: `${rest.length} other projects`,
      color: OTHER_COLOR,
      seconds: rest.reduce((sum, x) => sum + x.seconds, 0),
    },
  ];
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
  const projects = useProjects();
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const byDay = new Map<string, number>();
  const entriesByDay = new Map<string, TimeEntry[]>();
  for (const e of entries) {
    byDay.set(e.entryDate, (byDay.get(e.entryDate) ?? 0) + entrySeconds(e, now));
    entriesByDay.set(e.entryDate, [...(entriesByDay.get(e.entryDate) ?? []), e]);
  }
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
        {days.map((d, i) => {
          const secs = byDay.get(d) ?? 0;
          const segments = daySegments(entriesByDay.get(d) ?? [], projectById, now);
          const working = settings.workingDays.includes(dayOfWeek(d));
          const target = working ? settings.workdayMinutes * 60 : 0;
          // The coloured part fills up towards a full working day; past that the bar is full.
          const empty = target && secs < target ? target - secs : 0;
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
                {segments.map((sg) => (
                  <span key={sg.key} style={{ flexGrow: sg.seconds, background: sg.color }} />
                ))}
                {(empty > 0 || segments.length === 0) && (
                  <span className="week-strip__rest" style={{ flexGrow: empty || 1 }} />
                )}
              </span>
              {segments.length > 0 && (
                <>
                  <span className="sr-only">
                    {segments.map((sg) => `${sg.label} ${formatDuration(sg.seconds)}`).join(", ")}
                  </span>
                  <span
                    className="week-strip__tip"
                    aria-hidden="true"
                    data-align={i >= 5 ? "end" : undefined}
                  >
                    {segments.map((sg) => (
                      <span key={sg.key} className="week-strip__tip-row">
                        <span className="week-strip__tip-dot" style={{ background: sg.color }} />
                        <span className="week-strip__tip-label">{sg.label}</span>
                        <span className="mono">{formatDuration(sg.seconds)}</span>
                      </span>
                    ))}
                  </span>
                </>
              )}
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
