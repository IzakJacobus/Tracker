import { addDays, dayOfWeek, formatDuration, localTime } from "@stint/shared";
import { BellRing, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../ui/Button.tsx";
import { useMyEntries, useNow, useSettings } from "./hooks.ts";

const DISMISS_KEY = "stint.reminder.dismissed";

/** Gentle nudge when today (after the reminder time) or the last working day is under-filled. */
export function Reminder({ today }: { today: string }) {
  const s = useSettings();
  const now = useNow(60_000);
  let prev = addDays(today, -1);
  for (let i = 0; i < 7 && !s.workingDays.includes(dayOfWeek(prev)); i++) prev = addDays(prev, -1);
  const entries = useMyEntries(prev, today);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY));
  const sum = (d: string) =>
    entries
      .filter((e) => e.entryDate === d)
      .reduce((a, e) => a + (e.durationS ?? Math.floor((now - e.startedAt) / 1000)), 0);
  const min = s.reminders.minMinutes * 60;
  const pastTime = localTime(now, s.timezone) >= s.reminders.time;
  let message: string | null = null;
  let key = "";
  if (s.reminders.enabled) {
    if (s.workingDays.includes(dayOfWeek(today)) && pastTime && sum(today) < min) {
      message = `You've tracked ${formatDuration(sum(today))} today. A usual day is ${formatDuration(s.workdayMinutes * 60)}.`;
      key = today;
    } else if (sum(prev) < min) {
      message = `Your last working day (${prev}) only has ${formatDuration(sum(prev))}. Fill in the gaps while you remember.`;
      key = prev;
    }
  }
  const show = Boolean(message) && dismissed !== key;

  useEffect(() => {
    if (!show || !message || typeof Notification === "undefined" || Notification.permission !== "granted")
      return;
    const k = `stint.reminder.notified.${key}`;
    if (localStorage.getItem(k)) return;
    localStorage.setItem(k, "1");
    new Notification("Stint", { body: message, icon: "/icons/icon-192.png" });
  }, [show, message, key]);

  if (!show) return null;
  return (
    <div className="reminder" role="status">
      <BellRing aria-hidden="true" />
      <span className="grow">{message}</span>
      {typeof Notification !== "undefined" && Notification.permission === "default" && (
        <Button size="sm" variant="ghost" onClick={() => void Notification.requestPermission()}>
          Remind me with notifications
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        iconOnly
        label="Dismiss reminder"
        icon={<X />}
        onClick={() => {
          localStorage.setItem(DISMISS_KEY, key);
          setDismissed(key);
        }}
      />
    </div>
  );
}
