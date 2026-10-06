import {
  formatDuration,
  localDate,
  MAX_ENTRY_SECONDS,
  parseDurationInput,
  type TimeEntry,
} from "@stint/shared";
import { Lock, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useMe } from "../app/session.tsx";
import { useData } from "../data/DataProvider.tsx";
import { nextFreeStart } from "../data/entries.ts";
import { Button } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { Field, Input, Textarea } from "../ui/Field.tsx";
import { Alert } from "../ui/misc.tsx";
import { useToast } from "../ui/Toast.tsx";
import { type Combo, useLocks, useSettings } from "./hooks.ts";
import { ProjectPicker } from "./ProjectPicker.tsx";
import { TagPicker } from "./TagPicker.tsx";

export interface EntryDialogProps {
  entry?: TimeEntry;
  /** defaults for a new entry */
  date?: string;
  durationS?: number;
  combo?: Combo | null;
  onClose: () => void;
}

/** Log hours: the date, what you worked on (a project, drilled down to its item), hours and a note. */
export function EntryDialog({ entry, date, durationS, combo, onClose }: EntryDialogProps) {
  const { db, entries } = useData();
  const me = useMe();
  const settings = useSettings();
  const toast = useToast();
  const lockFor = useLocks();
  const tz = settings.timezone;
  const initialDuration = entry?.durationS ?? durationS ?? 0;

  const [f, setF] = useState({
    combo: entry ? { projectId: entry.projectId, taskId: null } : (combo ?? null),
    description: entry?.description ?? "",
    date: entry ? entry.entryDate : (date ?? localDate(Date.now(), tz)),
    hours: initialDuration ? formatDuration(initialDuration) : "",
    tagIds: entry?.tagIds ?? [],
  });
  const [error, setError] = useState<string | null>(null);
  const lock = lockFor(f.date) ?? (entry ? lockFor(entry.entryDate) : undefined);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!f.combo) return setError("Choose what you worked on.");
    const secs = parseDurationInput(f.hours);
    if (secs === null || secs <= 0) return setError("Enter the hours, e.g. 1.5 or 1:30.");
    if (secs > MAX_ENTRY_SECONDS)
      return setError("An entry can be at most 24 hours. Split longer work over two days.");
    // Entries only need a date; a start time keeps them in order within the day.
    const day = await db.timeEntries
      .where("[userId+entryDate]")
      .equals([entry?.userId ?? me.user.id, f.date])
      .toArray();
    const startedAt =
      entry && entry.entryDate === f.date
        ? entry.startedAt
        : nextFreeStart(
            day.filter((d) => d.id !== entry?.id),
            f.date,
            settings.workdayStart,
            tz,
          );
    if (entry) {
      await entries.update(entry.id, {
        projectId: f.combo.projectId,
        taskId: null,
        description: f.description,
        startedAt,
        durationS: secs,
        tagIds: f.tagIds,
      });
      toast.success("Entry saved.");
    } else {
      await entries.create({
        projectId: f.combo.projectId,
        taskId: null,
        description: f.description,
        startedAt,
        durationS: secs,
        tagIds: f.tagIds,
        source: "manual",
      });
      toast.success(`Logged ${formatDuration(secs)}.`);
    }
    onClose();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={entry ? "Edit hours" : "Log hours"}
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
              {entry ? "Save" : "Log hours"}
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
          <Field label="Worked on" hint="Choose the project, then the item under it">
            <ProjectPicker
              value={f.combo}
              onChange={(c) => setF({ ...f, combo: c })}
              autoOpen={!entry && !f.combo}
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
            <Field label="Hours" hint="e.g. 1.5, 1:30 or 90m">
              <Input
                value={f.hours}
                onChange={(e) => setF({ ...f, hours: e.target.value })}
                inputMode="decimal"
                className="mono"
                placeholder="0:00"
              />
            </Field>
          </div>
          <Field label="Note" hint="Optional">
            <Textarea
              rows={2}
              value={f.description}
              onChange={(e) => setF({ ...f, description: e.target.value })}
              placeholder="What did you do?"
            />
          </Field>
          <div className="row">
            <span className="field__label">Tags</span>
            <TagPicker value={f.tagIds} onChange={(ids) => setF({ ...f, tagIds: ids })} compact />
          </div>
        </fieldset>
      </form>
    </Dialog>
  );
}
