import { formatDuration, localTime, type TimeEntry } from "@stint/shared";
import { Coffee } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useData } from "../data/DataProvider.tsx";
import { desktop, isDesktop } from "../lib/desktop.ts";
import { Button } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { useRunningEntry, useSettings } from "./hooks.ts";
import { comboKey, usePickerItems } from "./ProjectPicker.tsx";
import { requestTimerToggle } from "./TimerDock.tsx";

interface Away {
  from: number;
  to: number;
  entry: TimeEntry;
}

/** Desktop-only glue: tray timer, idle detection. Renders nothing in the browser. */
export function DesktopBridge() {
  if (!isDesktop()) return null;
  return <Bridge />;
}

function Bridge() {
  const { entries } = useData();
  const settings = useSettings();
  const running = useRunningEntry();
  const { byKey } = usePickerItems();
  const [away, setAway] = useState<Away | null>(null);
  const awayStart = useRef<number | null>(null);

  // Tray menu "Start/Stop timer".
  useEffect(() => {
    const p = desktop.onTrayToggle(() => requestTimerToggle());
    return () => {
      void p.then((un) => un());
    };
  }, []);

  // Keep the tray tooltip current.
  useEffect(() => {
    const update = () => {
      if (!running) {
        void desktop.trayUpdate(false, "Stint — no timer running").catch(() => {});
        return;
      }
      const item = byKey.get(comboKey({ projectId: running.projectId, taskId: running.taskId }));
      const secs = Math.floor((Date.now() - running.startedAt) / 1000);
      const label = [item?.projectLabel, running.description].filter(Boolean).join(" · ");
      void desktop.trayUpdate(true, `Stint — ${formatDuration(secs)} ${label}`.slice(0, 120)).catch(() => {});
    };
    update();
    const t = setInterval(update, 30_000);
    return () => clearInterval(t);
  }, [running, byKey]);

  // Idle detection while a timer runs.
  useEffect(() => {
    awayStart.current = null;
    if (!running || settings.idleMinutes <= 0) return;
    const threshold = settings.idleMinutes * 60;
    const t = setInterval(async () => {
      let idle = 0;
      try {
        idle = await desktop.idleSeconds();
      } catch {
        return;
      }
      if (awayStart.current === null && idle >= threshold) {
        awayStart.current = Math.max(running.startedAt, Date.now() - idle * 1000);
      } else if (awayStart.current !== null && idle < 5) {
        setAway({ from: awayStart.current, to: Date.now(), entry: running });
        awayStart.current = null;
      }
    }, 10_000);
    return () => clearInterval(t);
  }, [running, settings.idleMinutes]);

  if (!away) return null;
  const minutes = Math.round((away.to - away.from) / 60_000);
  const tz = settings.timezone;
  const keptSeconds = Math.max(0, Math.round((away.from - away.entry.startedAt) / 1000));

  return (
    <Dialog
      open
      onClose={() => setAway(null)}
      title={`You were away for ${minutes} minute${minutes === 1 ? "" : "s"}`}
      footer={
        <>
          <Button
            onClick={async () => {
              await entries.update(away.entry.id, { durationS: keptSeconds });
              setAway(null);
            }}
          >
            Discard and stop
          </Button>
          <Button
            onClick={async () => {
              await entries.update(away.entry.id, { durationS: keptSeconds });
              await entries.start({
                projectId: away.entry.projectId,
                taskId: away.entry.taskId,
                description: away.entry.description,
                tagIds: away.entry.tagIds,
                billable: away.entry.billable,
              });
              setAway(null);
            }}
          >
            Discard and continue
          </Button>
          <Button variant="primary" onClick={() => setAway(null)}>
            Keep the time
          </Button>
        </>
      }
    >
      <div className="row" style={{ gap: 14, alignItems: "flex-start" }}>
        <Coffee aria-hidden="true" style={{ flex: "none", color: "var(--live)" }} />
        <p>
          Your timer kept running from <strong>{localTime(away.from, tz)}</strong> to{" "}
          <strong>{localTime(away.to, tz)}</strong> while this computer wasn't used. Keep that time, or take
          it off the entry?
        </p>
      </div>
    </Dialog>
  );
}
