import {
  formatDuration,
  localDate,
  localTime,
  MAX_ENTRY_SECONDS,
  parseDurationInput,
  parseTimeInput,
  type TimeEntry,
  zonedToInstant,
} from "@stint/shared";
import { Lock, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useMe } from "../app/session.tsx";
import { useData } from "../data/DataProvider.tsx";
import { nextFreeStart } from "../data/entries.ts";
import { Button } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { Field, Input, Switch, Textarea } from "../ui/Field.tsx";
import { Alert } from "../ui/misc.tsx";
import { useToast } from "../ui/Toast.tsx";
import { type Combo, useLocks, useSettings } from "./hooks.ts";
import { ProjectPicker } from "./ProjectPicker.tsx";
import { TagPicker } from "./TagPicker.tsx";

export interface EntryDialogProps {
  entry?: TimeEntry;
  /** defaults for a new entry */
  date?: string;
  startTime?: string;
  durationS?: number;
  combo?: Combo | null;
  onClose: () => void;
}

export function EntryDialog({ entry, date, startTime, durationS, combo, onClose }: EntryDialogProps) {
  const { db, entries } = useData();
  const me = useMe();
  const settings = useSettings();
  const toast = useToast();
  const lockFor = useLocks();
  const tz = settings.timezone;
  const running = entry?.durationS === null;
  const initialDate = entry ? entry.entryDate : (date ?? localDate(Date.now(), tz));
  const initialStart = entry ? localTime(entry.startedAt, tz) : (startTime ?? "");
  const initialDuration = entry?.durationS ?? durationS ?? 0;

  const [f, setF] = useState({
    combo: entry ? { projectId: entry.projectId, taskId: entry.taskId } : (combo ?? null),
    description: entry?.description ?? "",
    date: initialDate,
    start: initialStart,
    end: initialStart && initialDuration ? endFrom(initialDate, initialStart, initialDuration, tz) : "",
    duration: initialDuration ? formatDuration(initialDuration) : "",
    tagIds: entry?.tagIds ?? [],
    billable: entry?.billable ?? null,
  });
  const [error, setError] = useState<string | null>(null);
  const lock = lockFor(f.date) ?? (entry ? lockFor(entry.entryDate) : undefined);

  function setStart(v: string) {
    const t = parseTimeInput(v);
    const d = parseDurationInput(f.duration);
    setF({ ...f, start: v, end: t && d ? endFrom(f.date, t, d, tz) : f.end });
  }
  function setEnd(v: string) {
    const s = parseTimeInput(f.start);
    const e = parseTimeInput(v);
    if (s && e) {
      let secs = (toMinutes(e) - toMinutes(s)) * 60;
      if (secs < 0) secs += 24 * 3600; // ends after midnight
      setF({ ...f, end: v, duration: formatDuration(secs) });
    } else setF({ ...f, end: v });
  }
  function setDuration(v: string) {
    const s = parseTimeInput(f.start);
    const d = parseDurationInput(v);
    setF({ ...f, duration: v, end: s && d ? endFrom(f.date, s, d, tz) : f.end });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!f.combo) return setError("Choose a project.");
    const secs = running ? null : parseDurationInput(f.duration);
    if (!running && (secs === null || secs <= 0)) return setError("Enter how long, e.g. 1:30 or 1.5.");
    if (secs !== null && secs > MAX_ENTRY_SECONDS)
      return setError("An entry can be at most 24 hours. Split longer work over two entries.");
    const start = f.start.trim() ? parseTimeInput(f.start) : null;
    if (f.start.trim() && !start) return setError("Enter the start time as e.g. 09:30.");
    let startedAt: number;
    if (start) startedAt = zonedToInstant(f.date, start, tz);
    else {
      const day = await db.timeEntries
        .where("[userId+entryDate]")
        .equals([entry?.userId ?? me.user.id, f.date])
        .toArray();
      startedAt =
        entry && entry.entryDate === f.date
          ? entry.startedAt
          : nextFreeStart(day, f.date, settings.workdayStart, tz);
    }
    const billable = f.billable ?? (await entries.billableFor(f.combo.projectId, f.combo.taskId));
    if (entry) {
      await entries.update(entry.id, {
        projectId: f.combo.projectId,
        taskId: f.combo.taskId,
        description: f.description,
        startedAt,
        ...(running ? {} : { durationS: secs }),
        tagIds: f.tagIds,
        billable,
      });
      toast.success("Entry saved.");
    } else {
      await entries.create({
        projectId: f.combo.projectId,
        taskId: f.combo.taskId,
        description: f.description,
        startedAt,
        durationS: secs,
        tagIds: f.tagIds,
        billable,
        source: "manual",
      });
      toast.success(`Added ${formatDuration(secs ?? 0)}.`);
    }
    onClose();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={entry ? (running ? "Running timer" : "Edit time entry") : "Add time"}
      footer={
        <>
          {entry && !lock && (
            <Button
              variant="ghost"
              icon={<Trash2 />}
              style={{ marginRight: "auto", color: "var(--danger)" }}
              onClick={async () => {
                const removed = await entries.remove(entry.id);
                onClose();
                if (removed)
                  toast.show("Entry deleted.", {
                    action: { label: "Undo", onClick: () => void entries.restore(removed) },
                  });
              }}
            >
              Delete
            </Button>
          )}
          <Button onClick={onClose}>{lock ? "Close" : "Cancel"}</Button>
          {!lock && (
            <Button variant="primary" type="submit" form="entry-form">
              {entry ? "Save" : "Add time"}
            </Button>
          )}
        </>
      }
    >
      <form id="entry-form" className="stack" onSubmit={submit} noValidate>
        {lock && (
          <Alert
            tone="info"
            title={lock.status === "approved" ? "Approved and locked" : "Submitted for approval"}
          >
            <span className="row" style={{ gap: 6 }}>
              <Lock size={14} /> Time in {lock.periodStart} – {lock.periodEnd} can't be changed
              {lock.status === "submitted"
                ? " while it's waiting for approval."
                : ". Ask an admin to unlock it."}
            </span>
          </Alert>
        )}
        {error && <Alert tone="danger">{error}</Alert>}
        <fieldset disabled={Boolean(lock)} className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <Field label="Project">
            <ProjectPicker
              value={f.combo}
              onChange={(c) => setF({ ...f, combo: c, billable: null })}
              autoOpen={!entry && !f.combo}
            />
          </Field>
          <Field label="Description">
            <Textarea
              rows={2}
              value={f.description}
              onChange={(e) => setF({ ...f, description: e.target.value })}
              placeholder="What did you work on?"
            />
          </Field>
          <div className="entry-times">
            <Field label="Date">
              <Input
                type="date"
                value={f.date}
                onChange={(e) => setF({ ...f, date: e.target.value })}
                required
              />
            </Field>
            <Field label="Start" hint="Optional">
              <Input
                value={f.start}
                onChange={(e) => setStart(e.target.value)}
                placeholder="09:00"
                inputMode="numeric"
              />
            </Field>
            <Field label="End">
              <Input
                value={f.end}
                onChange={(e) => setEnd(e.target.value)}
                placeholder="—"
                inputMode="numeric"
                disabled={running}
              />
            </Field>
            <Field label="Duration" hint={running ? "Still running" : "e.g. 1:30, 1.5, 90m"}>
              <Input
                value={running ? "running" : f.duration}
                onChange={(e) => setDuration(e.target.value)}
                disabled={running}
                className="mono"
              />
            </Field>
          </div>
          <div className="row row--wrap" style={{ gap: 16 }}>
            <div className="row">
              <span className="field__label">Tags</span>
              <TagPicker value={f.tagIds} onChange={(ids) => setF({ ...f, tagIds: ids })} compact />
            </div>
            <Switch
              checked={f.billable ?? true}
              onChange={(v) => setF({ ...f, billable: v })}
              label={f.billable === null ? "Billable (project default)" : "Billable"}
            />
          </div>
        </fieldset>
      </form>
    </Dialog>
  );
}

function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number) as [number, number];
  return h * 60 + m;
}

function endFrom(date: string, start: string, seconds: number, tz: string): string {
  return localTime(zonedToInstant(date, start, tz) + seconds * 1000, tz);
}
