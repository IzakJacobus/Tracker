import { dayOfWeek, formatDuration, parseIsoDate, type TimeEntry } from "@stint/shared";
import { CheckCircle2, Clock, Copy, Lock, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { useData } from "../../data/DataProvider.tsx";
import { useTags } from "../../data/hooks.ts";
import { fmtDate } from "../../lib/format.ts";
import { useLocks, useSettings } from "../../tracking/hooks.ts";
import { ComboLabel, comboKey, usePickerItems } from "../../tracking/ProjectPicker.tsx";
import { useMarkDone } from "../../tracking/useMarkDone.ts";
import { Button } from "../../ui/Button.tsx";
import { EmptyState } from "../../ui/misc.tsx";
import { Menu, Popover } from "../../ui/Popover.tsx";
import { useToast } from "../../ui/Toast.tsx";

const DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function ListView({
  entries,
  onEdit,
  onAdd,
  onLogMore,
}: {
  entries: TimeEntry[];
  onEdit: (e: TimeEntry) => void;
  onAdd: () => void;
  /** Log more hours on the same item and day. */
  onLogMore: (e: TimeEntry) => void;
}) {
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
        icon={<Clock />}
        title="No hours logged this week"
        action={
          <Button variant="primary" onClick={onAdd}>
            Log hours
          </Button>
        }
      >
        Choose what you worked on and how many hours. Press <kbd>N</kbd> to log hours from anywhere, or use
        the week grid to fill in a whole week.
      </EmptyState>
    );
  }

  return (
    <div className="stack">
      {days.map((d) => {
        const list = byDay.get(d)!;
        const total = list.reduce((s, e) => s + (e.durationS ?? 0), 0);
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
                <EntryRow key={e.id} entry={e} onEdit={onEdit} onLogMore={onLogMore} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function EntryRow({
  entry,
  onEdit,
  onLogMore,
}: {
  entry: TimeEntry;
  onEdit: (e: TimeEntry) => void;
  onLogMore: (e: TimeEntry) => void;
}) {
  const { entries } = useData();
  const { byKey, byId } = usePickerItems();
  const markDone = useMarkDone();
  const tags = useTags();
  const toast = useToast();
  const lockFor = useLocks();
  const lock = lockFor(entry.entryDate);
  const menuAnchor = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState(false);
  const item = byKey.get(comboKey({ projectId: entry.projectId, taskId: null }));
  const secs = entry.durationS ?? 0;
  const entryTags = tags.filter((t) => entry.tagIds.includes(t.id));
  // The item the hours are on, and the top-level project it belongs to: either can be marked done.
  let root = item ? byId.get(item.projectId) : undefined;
  while (root?.parentId && byId.get(root.parentId)) root = byId.get(root.parentId);
  const doneTargets = [
    ...(item?.loggable ? [{ id: item.projectId, name: item.name }] : []),
    ...(item?.loggable && root && root.projectId !== item.projectId
      ? [{ id: root.projectId, name: root.name, whole: true }]
      : []),
  ];

  const remove = async () => {
    const removed = await entries.remove(entry.id);
    if (removed)
      toast.show("Entry deleted.", {
        action: { label: "Undo", onClick: () => void entries.restore(removed) },
      });
  };

  return (
    <li className="entry-row" data-locked={lock ? true : undefined}>
      <button
        type="button"
        className="entry-row__main"
        onClick={() => onEdit(entry)}
        aria-label={`Edit entry: ${entry.description || item?.projectLabel || "entry"}`}
      >
        <span className="entry-row__desc truncate">
          {entry.description || <span className="subtle">No note</span>}
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
        {lock && (
          <span
            className="badge badge--info"
            title={`${lock.status === "approved" ? "Approved" : "Submitted"} — locked`}
          >
            <Lock size={12} /> {lock.status === "approved" ? "Approved" : "Submitted"}
          </span>
        )}
      </div>
      <span className="entry-row__dur mono">{formatDuration(secs)}</span>
      <div className="entry-row__actions">
        <Button
          size="sm"
          variant="ghost"
          iconOnly
          label="Log more hours on this"
          icon={<Plus />}
          onClick={() => onLogMore(entry)}
        />
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
              { label: "Log more hours on this", icon: <Plus />, onSelect: () => onLogMore(entry) },
              ...(doneTargets.length
                ? [
                    "sep" as const,
                    ...doneTargets.map((t) => ({
                      label: "whole" in t ? `Mark whole project “${t.name}” done` : `Mark “${t.name}” done`,
                      icon: <CheckCircle2 />,
                      onSelect: () => void markDone(t.id, t.name),
                    })),
                  ]
                : []),
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
