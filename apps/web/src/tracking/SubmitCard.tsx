import { addDays, dayOfWeek, formatDuration, isWithin, periodFor, type Timesheet } from "@stint/shared";
import { useLiveQuery } from "dexie-react-hooks";
import { CheckCircle2, Clock, Send, Undo2 } from "lucide-react";
import { useState } from "react";
import { useMe } from "../app/session.tsx";
import { useData, useSyncStatus } from "../data/DataProvider.tsx";
import { api, errorMessage } from "../lib/api.ts";
import { rangeLabel } from "../pages/track/WeekHeader.tsx";
import { Button } from "../ui/Button.tsx";
import { ConfirmDialog } from "../ui/Dialog.tsx";
import { Alert } from "../ui/misc.tsx";
import { useToast } from "../ui/Toast.tsx";
import { useSettings } from "./hooks.ts";

/**
 * "Submit your timesheet" — shown on Track for the previous period (if still
 * open) or the current one. Submitting needs the server; everything else
 * keeps working offline.
 */
export function SubmitCard({ today }: { today: string }) {
  const me = useMe();
  const settings = useSettings();
  const { db, mutate, engine } = useData();
  const sync = useSyncStatus();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const current = periodFor(today, settings.approvalPeriod, settings.approvalDay);
  const previous = periodFor(addDays(current.start, -1), settings.approvalPeriod, settings.approvalDay);
  const sheets =
    useLiveQuery(() => db.timesheets.where("userId").equals(me.user.id).toArray(), [db, me.user.id]) ?? [];
  const byStart = new Map(sheets.map((s) => [s.periodStart, s]));
  const prevSheet = byStart.get(previous.start);
  const prevCount =
    useLiveQuery(
      () =>
        db.timeEntries
          .where("[userId+entryDate]")
          .between([me.user.id, previous.start], [me.user.id, previous.end], true, true)
          .count(),
      [db, me.user.id, previous.start, previous.end],
    ) ?? 0;
  // Nag about last period only if it has time in it and is still open.
  const prevOpen =
    prevCount > 0 && (!prevSheet || prevSheet.status === "draft" || prevSheet.status === "rejected");
  const period = prevOpen ? previous : current;
  const sheet: Timesheet | undefined = byStart.get(period.start);
  const entries =
    useLiveQuery(
      () =>
        db.timeEntries
          .where("[userId+entryDate]")
          .between([me.user.id, period.start], [me.user.id, period.end], true, true)
          .toArray(),
      [db, me.user.id, period.start, period.end],
    ) ?? [];
  const total = entries.reduce((s, e) => s + (e.durationS ?? 0), 0);
  const byDay = new Map<string, number>();
  for (const e of entries) byDay.set(e.entryDate, (byDay.get(e.entryDate) ?? 0) + (e.durationS ?? 0));
  const shortDays: string[] = [];
  for (let d = period.start; d <= period.end && d < today; d = addDays(d, 1)) {
    if (
      settings.workingDays.includes(dayOfWeek(d)) &&
      (byDay.get(d) ?? 0) < settings.reminders.minMinutes * 60
    )
      shortDays.push(d);
  }
  const offline = sync.state === "offline";
  const status = sheet?.status ?? "draft";
  const label = rangeLabel(period.start, period.end);
  const isPast = period.end < today;

  async function submit() {
    setBusy(true);
    try {
      // Send any unsent edits first: once submitted, the server refuses changes in this period.
      await engine.syncNow();
      if ((await db.outbox.count()) > 0) {
        toast.error("Some of your changes haven't reached the server yet. Wait for “Synced”, then submit.");
        return;
      }
      await mutate(() => api.post("/timesheets/submit", { date: period.start }));
      toast.success(`Timesheet for ${label} submitted.`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }

  if (status === "approved" && !prevOpen) {
    return (
      <Alert tone="success" title={`${label} is approved`}>
        Nice work — that period is locked.
      </Alert>
    );
  }

  return (
    <section className="card submit-card" aria-label="Timesheet submission">
      <div className="submit-card__body">
        <div className="submit-card__icon" data-status={status}>
          {status === "submitted" ? <Clock /> : status === "approved" ? <CheckCircle2 /> : <Send />}
        </div>
        <div className="grow stack stack--sm" style={{ gap: 2 }}>
          <strong>
            {status === "submitted"
              ? `${label} is waiting for approval`
              : status === "rejected"
                ? `${label} was sent back`
                : isPast
                  ? `Submit your timesheet for ${label}`
                  : `Timesheet for ${label}`}
          </strong>
          <span className="muted" style={{ fontSize: "var(--text-sm)" }}>
            {formatDuration(total)} h tracked
            {shortDays.length > 0 &&
              status !== "submitted" &&
              ` · ${shortDays.length} working day${shortDays.length === 1 ? "" : "s"} look short`}
            {status === "submitted" && " · entries are locked until your manager decides"}
          </span>
          {status === "rejected" && sheet?.comment && (
            <span style={{ fontSize: "var(--text-sm)" }}>
              <strong>Comment:</strong> {sheet.comment}
            </span>
          )}
        </div>
        {status === "submitted" ? (
          <Button
            icon={<Undo2 />}
            disabled={offline}
            onClick={async () => {
              try {
                await mutate(() => api.post(`/timesheets/${sheet!.id}/withdraw`));
                toast.show("Timesheet withdrawn — you can edit it again.");
              } catch (e) {
                toast.error(errorMessage(e));
              }
            }}
          >
            Withdraw
          </Button>
        ) : (
          <Button
            variant={isPast ? "primary" : "default"}
            icon={<Send />}
            disabled={offline || total === 0}
            title={offline ? "Connect to the office network to submit" : undefined}
            onClick={() => setConfirm(true)}
          >
            {status === "rejected" ? "Submit again" : "Submit"}
          </Button>
        )}
      </div>
      {offline && status !== "submitted" && (
        <p className="subtle submit-card__note">Submitting needs a connection to the Stint server.</p>
      )}
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => void submit()}
        busy={busy}
        title={`Submit ${label}?`}
        confirmLabel="Submit for approval"
        message={`You've tracked ${formatDuration(total)} h. After submitting, you can't change entries in this period unless your manager sends it back.`}
      >
        {shortDays.length > 0 && (
          <Alert tone="warning" title="Some days look short">
            {shortDays.slice(0, 8).join(", ")}
            {shortDays.length > 8 ? "…" : ""} have less than {settings.reminders.minMinutes / 60} h.
          </Alert>
        )}
      </ConfirmDialog>
    </section>
  );
}

export function isInPeriod(date: string, t: Timesheet) {
  return isWithin(date, t.periodStart, t.periodEnd);
}
