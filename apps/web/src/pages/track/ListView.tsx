import { dayOfWeek, formatDuration, parseIsoDate, type TimeEntry } from "@stint/shared";
import { Copy, Lock, MoreHorizontal, Pencil, Play, Timer, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { useData } from "../../data/DataProvider.tsx";
import { useTags } from "../../data/hooks.ts";
import { fmtDate } from "../../lib/format.ts";
import { fmtClock, useLocks, useNow, useSettings } from "../../tracking/hooks.ts";
import { ComboLabel, comboKey, usePickerItems } from "../../tracking/ProjectPicker.tsx";
import { Button } from "../../ui/Button.tsx";
import { EmptyState } from "../../ui/misc.tsx";
import { Menu, Popover } from "../../ui/Popover.tsx";
import { useToast } from "../../ui/Toast.tsx";
import { entrySeconds } from "./WeekHeader.tsx";

const DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function ListView({
  entries,
  onEdit,
  onAdd,
}: {
  entries: TimeEntry[];
  onEdit: (e: TimeEntry) => void;
  onAdd: () => void;
}) {
  const now = useNow(1000);
  const settings = useSettings();
  const byDay = new Map<string, TimeEntry[]>();
  for (const e of [...entries].sort((a, b) => b.startedAt - a.startedAt)) {
    const list = byDay.get(e.entryDate) ?? [];
    list.push(e);
    byDay.set(e.entryDate, list);
  }
  const days = [...byDay.keys()].sort().reverse();

  if (days.length === 0) {
    return (
      <EmptyState
        icon={<Timer />}
        title="No time tracked this week"
        action={
          <Button variant="primary" onClick={onAdd}>
            Add time
          </Button>
        }
      >
        Press the play button at the bottom of the screen to start a timer, or add time you've already worked.
        Press <kbd>S</kbd> to start and stop from anywhere.
      </EmptyState>
    );
  }

  return (
    <div className="stack">
      {days.map((d) => {
        const list = byDay.get(d)!;
        const total = list.reduce((s, e) => s + entrySeconds(e, now), 0);
        return (
          <section key={d} className="card day-card" aria-label={d}>
            <header className="day-card__head">
              <h3>
                {DAY[dayOfWeek(d)]}{" "}
                <span className="subtle">
                  {settings.dateFormat === "YYYY-MM-DD" ? d : fmtDate(d, settings)}
                </span>
              </h3>
              <span className="mono">{formatDuration(total)}</span>
            </header>
            <ul className="entry-list">
              {list.map((e) => (
                <EntryRow key={e.id} entry={e} now={now} onEdit={onEdit} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function EntryRow({ entry, now, onEdit }: { entry: TimeEntry; now: number; onEdit: (e: TimeEntry) => void }) {
  const { entries } = useData();
  const { byKey } = usePickerItems();
  const tags = useTags();
  const settings = useSettings();
  const toast = useToast();
  const lockFor = useLocks();
  const lock = lockFor(entry.entryDate);
  const menuAnchor = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState(false);
  const running = entry.durationS === null;
  const item = byKey.get(comboKey({ projectId: entry.projectId, taskId: entry.taskId }));
  const secs = entrySeconds(entry, now);
  const end = entry.startedAt + secs * 1000;
  const entryTags = tags.filter((t) => entry.tagIds.includes(t.id));

  const remove = async () => {
    const removed = await entries.remove(entry.id);
    if (removed)
      toast.show("Entry deleted.", {
        action: { label: "Undo", onClick: () => void entries.restore(removed) },
      });
  };

  return (
    <li className="entry-row" data-running={running || undefined} data-locked={lock ? true : undefined}>
      <button
        type="button"
        className="entry-row__main"
        onClick={() => onEdit(entry)}
        aria-label={`Edit entry: ${entry.description || item?.projectLabel || "entry"}`}
      >
        <span className="entry-row__desc truncate">
          {entry.description || <span className="subtle">No description</span>}
        </span>
        <span className="entry-row__project">
          <ComboLabel item={item} />
          {!item && <span className="subtle">(project not available)</span>}
        </span>
      </button>
      <div className="entry-row__meta">
        {entryTags.map((t) => (
          <span key={t.id} className="badge" style={{ background: `${t.color}22`, color: t.color }}>
            {t.name}
          </span>
        ))}
        {!entry.billable && (
          <span className="badge" title="Non-billable">
            Non-billable
          </span>
        )}
        {lock && (
          <span
            className="badge badge--info"
            title={`${lock.status === "approved" ? "Approved" : "Submitted"} — locked`}
          >
            <Lock size={12} /> {lock.status === "approved" ? "Approved" : "Submitted"}
          </span>
        )}
      </div>
      <span className="entry-row__times tnum subtle">
        {fmtClock(entry.startedAt, settings.timezone, settings.timeFormat)}–
        {running ? "now" : fmtClock(end, settings.timezone, settings.timeFormat)}
      </span>
      <span className="entry-row__dur mono" data-running={running || undefined}>
        {formatDuration(secs, running)}
      </span>
      <div className="entry-row__actions">
        {!running && (
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            label="Continue this entry"
            icon={<Play />}
            onClick={() => void entries.continueEntry(entry)}
          />
        )}
        <Button
          ref={menuAnchor}
          size="sm"
          variant="ghost"
          iconOnly
          label="More actions"
          icon={<MoreHorizontal />}
          onClick={() => setMenu((m) => !m)}
        />
        <Popover
          open={menu}
          onClose={() => setMenu(false)}
          anchor={menuAnchor}
          placement="bottom-end"
          role="menu"
          label="Entry actions"
        >
          <Menu
            onClose={() => setMenu(false)}
            items={[
              { label: lock ? "View" : "Edit", icon: <Pencil />, onSelect: () => onEdit(entry) },
              { label: "Duplicate", icon: <Copy />, onSelect: () => void entries.duplicate(entry) },
              { label: "Continue", icon: <Play />, onSelect: () => void entries.continueEntry(entry) },
              ...(lock
                ? []
                : ["sep" as const, { label: "Delete", icon: <Trash2 />, onSelect: remove, danger: true }]),
            ]}
          />
        </Popover>
      </div>
    </li>
  );
}

export function dayTitle(date: string): string {
  const { d } = parseIsoDate(date);
  return `${DAY[dayOfWeek(date)]} ${d}`;
}
