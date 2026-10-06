import { dayOfWeek, formatDuration, parseDurationInput, parseIsoDate, type TimeEntry } from "@stint/shared";
import { Plus, X } from "lucide-react";
import { type KeyboardEvent, useMemo, useRef, useState } from "react";
import { useData } from "../../data/DataProvider.tsx";
import { nextFreeStart, planCellChange } from "../../data/entries.ts";
import { type Combo, useFavorites, useLocks, useNow, useSettings } from "../../tracking/hooks.ts";
import { ComboLabel, comboKey, PickerList, usePickerItems } from "../../tracking/ProjectPicker.tsx";
import { Button } from "../../ui/Button.tsx";
import { Popover } from "../../ui/Popover.tsx";
import { useToast } from "../../ui/Toast.tsx";
import { entrySeconds } from "./WeekHeader.tsx";

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Spreadsheet-style weekly timesheet: projects as rows, days as columns.
 * Typing a total into a cell creates, grows or shrinks entries to match.
 */
export function WeekGrid({ days, entries }: { days: string[]; entries: TimeEntry[] }) {
  const { entries: repo } = useData();
  const settings = useSettings();
  const toast = useToast();
  const lockFor = useLocks();
  const favorites = useFavorites();
  const { items, byKey } = usePickerItems();
  const now = useNow(30_000);
  const [extra, setExtra] = useState<Combo[]>([]);
  const addAnchor = useRef<HTMLButtonElement>(null);
  const [adding, setAdding] = useState(false);

  const rows = useMemo(() => {
    const keys = new Map<string, Combo>();
    for (const e of [...entries].sort((a, b) => a.startedAt - b.startedAt)) {
      keys.set(comboKey(e), { projectId: e.projectId, taskId: e.taskId });
    }
    for (const c of [...favorites, ...extra]) if (!keys.has(comboKey(c))) keys.set(comboKey(c), c);
    return [...keys.values()];
  }, [entries, favorites, extra]);

  const cellSeconds = (c: Combo, d: string) =>
    entries
      .filter(
        (e) => e.projectId === c.projectId && (e.taskId ?? null) === (c.taskId ?? null) && e.entryDate === d,
      )
      .reduce((s, e) => s + entrySeconds(e, now), 0);

  async function setCell(c: Combo, date: string, raw: string) {
    const target = raw.trim() === "" ? 0 : parseDurationInput(raw);
    if (target === null) {
      toast.error(`“${raw}” isn't a duration. Try 1:30, 1.5 or 90m.`);
      return;
    }
    if (target > 24 * 3600) {
      toast.error("A day only has 24 hours.");
      return;
    }
    const cell = entries.filter(
      (e) => e.projectId === c.projectId && (e.taskId ?? null) === (c.taskId ?? null) && e.entryDate === date,
    );
    const plan = planCellChange(cell, target);
    for (const u of plan.updates) await repo.update(u.id, { durationS: u.durationS });
    for (const id of plan.deletes) await repo.remove(id);
    if (plan.add > 0) {
      const day = entries.filter((e) => e.entryDate === date);
      await repo.create({
        projectId: c.projectId,
        taskId: c.taskId,
        startedAt: nextFreeStart(day, date, settings.workdayStart, settings.timezone),
        durationS: plan.add,
        source: "grid",
      });
    }
  }

  const dayTotals = days.map((d) =>
    entries.filter((e) => e.entryDate === d).reduce((s, e) => s + entrySeconds(e, now), 0),
  );
  const grand = dayTotals.reduce((a, b) => a + b, 0);

  function onKey(e: KeyboardEvent<HTMLInputElement>, r: number, col: number) {
    const move = (dr: number, dc: number) => {
      const el = document.querySelector<HTMLInputElement>(`[data-cell="${r + dr}:${col + dc}"]`);
      if (el) {
        e.preventDefault();
        el.focus();
        el.select();
      } else if (e.key === "Enter") {
        // Nowhere to move: commit the value in place.
        e.currentTarget.blur();
      }
    };
    if (e.key === "ArrowDown" || e.key === "Enter") move(1, 0);
    else if (e.key === "ArrowUp") move(-1, 0);
    else if (e.key === "ArrowRight" && e.currentTarget.selectionStart === e.currentTarget.value.length)
      move(0, 1);
    else if (e.key === "ArrowLeft" && e.currentTarget.selectionStart === 0) move(0, -1);
    else if (e.key === "Escape") e.currentTarget.blur();
  }

  return (
    <div className="card grid-card">
      <div className="grid-scroll">
        <table className="table week-grid">
          <thead>
            <tr>
              <th scope="col">Project</th>
              {days.map((d) => (
                <th
                  key={d}
                  scope="col"
                  className="num"
                  data-weekend={!settings.workingDays.includes(dayOfWeek(d)) || undefined}
                >
                  {DAY[dayOfWeek(d)]} {parseIsoDate(d).d}
                </th>
              ))}
              <th scope="col" className="num">
                Total
              </th>
              <th aria-label="Remove row" />
            </tr>
          </thead>
          <tbody>
            {rows.map((c, r) => {
              const item = byKey.get(comboKey(c));
              const rowTotal = days.reduce((s, d) => s + cellSeconds(c, d), 0);
              return (
                <tr key={comboKey(c)}>
                  <th scope="row" className="week-grid__project">
                    <ComboLabel item={item} compact />
                  </th>
                  {days.map((d, col) => {
                    const secs = cellSeconds(c, d);
                    const locked = Boolean(lockFor(d));
                    return (
                      <td
                        key={d}
                        className="week-grid__cell"
                        data-weekend={!settings.workingDays.includes(dayOfWeek(d)) || undefined}
                      >
                        <input
                          key={`${comboKey(c)}-${d}-${secs}`}
                          data-cell={`${r}:${col}`}
                          className="week-grid__input mono"
                          defaultValue={secs ? formatDuration(secs) : ""}
                          placeholder="–"
                          disabled={locked || !item}
                          aria-label={`${item?.projectLabel ?? "Project"}${item?.taskName ? ` · ${item.taskName}` : ""}, ${d}`}
                          title={locked ? "Locked — this period is submitted or approved" : undefined}
                          inputMode="decimal"
                          onFocus={(e) => e.currentTarget.select()}
                          onKeyDown={(e) => onKey(e, r, col)}
                          onBlur={(e) => {
                            const v = e.currentTarget.value;
                            const was = secs ? formatDuration(secs) : "";
                            if (v.trim() !== was) void setCell(c, d, v);
                          }}
                        />
                      </td>
                    );
                  })}
                  <td className="num mono week-grid__total">{rowTotal ? formatDuration(rowTotal) : ""}</td>
                  <td>
                    {rowTotal === 0 && extra.some((x) => comboKey(x) === comboKey(c)) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        iconOnly
                        label="Remove row"
                        icon={<X />}
                        onClick={() => setExtra(extra.filter((x) => comboKey(x) !== comboKey(c)))}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
            <tr>
              <td colSpan={days.length + 3}>
                <Button
                  ref={addAnchor}
                  variant="ghost"
                  size="sm"
                  icon={<Plus />}
                  onClick={() => setAdding(true)}
                >
                  Add row
                </Button>
                <Popover
                  open={adding}
                  onClose={() => setAdding(false)}
                  anchor={addAnchor}
                  width={420}
                  label="Add a project row"
                >
                  <PickerList
                    items={items}
                    byKey={byKey}
                    selected={null}
                    onPick={(c) => {
                      setExtra([...extra, c]);
                      setAdding(false);
                      setTimeout(
                        () =>
                          document.querySelector<HTMLInputElement>(`[data-cell="${rows.length}:0"]`)?.focus(),
                        50,
                      );
                    }}
                  />
                </Popover>
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              {dayTotals.map((t, i) => (
                <td key={days[i]} className="num mono">
                  {t ? formatDuration(t) : ""}
                </td>
              ))}
              <td className="num mono">{formatDuration(grand)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="subtle grid-hint">
        Type hours into any cell — <kbd>1:30</kbd>, <kbd>1.5</kbd> or <kbd>90m</kbd>. A whole number up to 12
        is hours (<kbd>8</kbd>); above that it is minutes (<kbd>45</kbd>). <kbd>Enter</kbd> moves down, arrow
        keys move around. Your favourite projects always have a row.
      </p>
    </div>
  );
}
