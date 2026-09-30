import { formatDuration, localDate, type TimeEntry, zonedToInstant } from "@stint/shared";
import { type PointerEvent as RPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { useData } from "../../data/DataProvider.tsx";
import { fmtClock, useLocks, useNow, useSettings } from "../../tracking/hooks.ts";
import { comboKey, usePickerItems } from "../../tracking/ProjectPicker.tsx";

const HOUR_PX = 56;
const SNAP_MIN = 15;
const MIN_PER_PX = 60 / HOUR_PX;

interface Drag {
  id: string;
  mode: "move" | "resize";
  startY: number;
  origStart: number;
  origDur: number;
  deltaMin: number;
}

/** Lays overlapping blocks out side by side. */
function lanes(
  items: { id: string; top: number; bottom: number }[],
): Map<string, { lane: number; lanes: number }> {
  const sorted = [...items].sort((a, b) => a.top - b.top);
  const out = new Map<string, { lane: number; lanes: number }>();
  let group: typeof sorted = [];
  let groupEnd = -1;
  const flush = () => {
    const ends: number[] = [];
    const assigned = group.map((it) => {
      let lane = ends.findIndex((e) => e <= it.top);
      if (lane === -1) {
        lane = ends.length;
        ends.push(it.bottom);
      } else ends[lane] = it.bottom;
      return { id: it.id, lane };
    });
    for (const a of assigned) out.set(a.id, { lane: a.lane, lanes: ends.length });
    group = [];
  };
  for (const it of sorted) {
    if (it.top >= groupEnd && group.length) flush();
    group.push(it);
    groupEnd = Math.max(groupEnd, it.bottom);
  }
  if (group.length) flush();
  return out;
}

export function DayCalendar({
  date,
  entries,
  onEdit,
  onCreateAt,
}: {
  date: string;
  entries: TimeEntry[];
  onEdit: (e: TimeEntry) => void;
  onCreateAt: (startTime: string) => void;
}) {
  const settings = useSettings();
  const { entries: repo } = useData();
  const { byKey } = usePickerItems();
  const lockFor = useLocks();
  const now = useNow(30_000);
  const scroller = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dayStart = zonedToInstant(date, "00:00", settings.timezone);
  const isToday = localDate(now, settings.timezone) === date;
  const locked = Boolean(lockFor(date));

  useEffect(() => {
    // Start the view just before the working day.
    const [h] = settings.workdayStart.split(":").map(Number) as [number];
    scroller.current?.scrollTo({ top: Math.max(0, (h - 1) * HOUR_PX) });
  }, [settings.workdayStart]);

  const blocks = useMemo(() => {
    const dayEntries = entries.filter((e) => e.entryDate === date);
    const geo = dayEntries.map((e) => {
      let start = e.startedAt;
      let dur = e.durationS ?? Math.max(60, Math.floor((now - e.startedAt) / 1000));
      if (drag?.id === e.id) {
        if (drag.mode === "move") start = drag.origStart + drag.deltaMin * 60_000;
        else dur = Math.max(SNAP_MIN * 60, drag.origDur + drag.deltaMin * 60);
      }
      const top = ((start - dayStart) / 60_000) * (HOUR_PX / 60);
      const height = Math.max(18, (dur / 60) * (HOUR_PX / 60));
      return { e, start, dur, top, height };
    });
    const layout = lanes(geo.map((g) => ({ id: g.e.id, top: g.top, bottom: g.top + g.height })));
    return geo.map((g) => ({ ...g, ...layout.get(g.e.id)! }));
  }, [entries, date, now, drag, dayStart]);

  function onPointerDown(ev: RPointerEvent, e: TimeEntry, mode: Drag["mode"]) {
    if (locked || e.durationS === null) return;
    ev.stopPropagation();
    (ev.target as Element).setPointerCapture(ev.pointerId);
    setDrag({
      id: e.id,
      mode,
      startY: ev.clientY,
      origStart: e.startedAt,
      origDur: e.durationS,
      deltaMin: 0,
    });
  }
  function onPointerMove(ev: RPointerEvent) {
    if (!drag) return;
    const raw = (ev.clientY - drag.startY) * MIN_PER_PX;
    const deltaMin = Math.round(raw / SNAP_MIN) * SNAP_MIN;
    if (deltaMin !== drag.deltaMin) setDrag({ ...drag, deltaMin });
  }
  async function onPointerUp(e: TimeEntry) {
    const d = drag;
    setDrag(null);
    if (!d) return;
    if (d.deltaMin === 0) {
      onEdit(e);
      return;
    }
    if (d.mode === "move") await repo.update(e.id, { startedAt: d.origStart + d.deltaMin * 60_000 });
    else await repo.update(e.id, { durationS: Math.max(SNAP_MIN * 60, d.origDur + d.deltaMin * 60) });
  }

  const nowTop = ((now - dayStart) / 60_000) * (HOUR_PX / 60);

  return (
    <div className="card cal-card">
      <div className="cal-scroll" ref={scroller}>
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: clicking empty space is a shortcut; the Add time button covers keyboard users */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: see above */}
        <div
          className="cal"
          style={{ height: 24 * HOUR_PX }}
          onPointerMove={onPointerMove}
          onClick={(ev) => {
            if (locked || ev.target !== ev.currentTarget) return;
            const y = ev.clientY - ev.currentTarget.getBoundingClientRect().top;
            const minutes = Math.floor((y * MIN_PER_PX) / SNAP_MIN) * SNAP_MIN;
            onCreateAt(
              `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`,
            );
          }}
        >
          {Array.from({ length: 24 }, (_, h) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the 24 hour lines are fixed
            <div key={h} className="cal__hour" style={{ top: h * HOUR_PX }} aria-hidden="true">
              <span>
                {settings.timeFormat === "24h"
                  ? `${String(h).padStart(2, "0")}:00`
                  : `${h % 12 || 12} ${h < 12 ? "am" : "pm"}`}
              </span>
            </div>
          ))}
          {isToday && <div className="cal__now" style={{ top: nowTop }} aria-hidden="true" />}
          {blocks.map(({ e, start, dur, top, height, lane, lanes: n }) => {
            const item = byKey.get(comboKey(e));
            const color = item?.color ?? "#737a72";
            const running = e.durationS === null;
            return (
              // biome-ignore lint/a11y/useSemanticElements: a block holds a resize handle and pointer-drag logic; it behaves as a button for keyboard users
              <div
                key={e.id}
                className="cal__block"
                data-running={running || undefined}
                data-dragging={drag?.id === e.id || undefined}
                role="button"
                tabIndex={0}
                aria-label={`${e.description || item?.projectLabel || "Entry"}, ${fmtClock(start, settings.timezone, settings.timeFormat)}, ${formatDuration(dur)}`}
                style={{
                  top,
                  height,
                  left: `calc(64px + (100% - 72px) * ${lane / n})`,
                  width: `calc((100% - 72px) / ${n} - 4px)`,
                  borderLeftColor: color,
                  background: `color-mix(in srgb, ${color} 14%, var(--surface))`,
                }}
                onPointerDown={(ev) => onPointerDown(ev, e, "move")}
                onPointerUp={() => void onPointerUp(e)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter" || ev.key === " ") {
                    ev.preventDefault();
                    onEdit(e);
                  }
                }}
              >
                <div className="cal__block-title truncate">
                  {e.description || item?.projectLabel || "Entry"}
                </div>
                {height > 34 && (
                  <div className="cal__block-sub truncate">
                    {e.description ? `${item?.projectLabel ?? ""} · ` : ""}
                    {fmtClock(start, settings.timezone, settings.timeFormat)} · {formatDuration(dur)}
                  </div>
                )}
                {!running && !locked && (
                  <div
                    className="cal__resize"
                    onPointerDown={(ev) => onPointerDown(ev, e, "resize")}
                    onPointerUp={(ev) => {
                      ev.stopPropagation();
                      void onPointerUp(e);
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
      <p className="subtle grid-hint">
        Click an empty slot to add time there. Drag a block to move it; drag its bottom edge to change its
        length.
      </p>
    </div>
  );
}
