import { addDays, localDate, startOfWeek } from "@stint/shared";
import { List, Plus, Table2 } from "lucide-react";
import { useEffect } from "react";
import { useSearchParams } from "react-router";
import { useEntryDialog } from "../../tracking/EntryDialogHost.tsx";
import { useMyEntries, useSettings } from "../../tracking/hooks.ts";
import { Reminder } from "../../tracking/Reminder.tsx";
import { SubmitCard } from "../../tracking/SubmitCard.tsx";
import { Button } from "../../ui/Button.tsx";
import { Segmented } from "../../ui/Field.tsx";
import { ListView } from "./ListView.tsx";
import { WeekGrid } from "./WeekGrid.tsx";
import { WeekHeader } from "./WeekHeader.tsx";

type View = "list" | "week";
const VIEW_KEY = "stint.track.view";

export function TrackPage() {
  const settings = useSettings();
  const dialog = useEntryDialog();
  const [params, setParams] = useSearchParams();
  const today = localDate(Date.now(), settings.timezone);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get("date") ?? "") ? params.get("date")! : today;
  const stored = localStorage.getItem(VIEW_KEY);
  // "day" (a calendar of start and end times) was removed in 0.2: hours only.
  const view: View = (params.get("view") ?? stored) === "week" ? "week" : "list";
  const weekStart = startOfWeek(date, settings.weekStart);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const entries = useMyEntries(days[0]!, days[6]!);

  const set = (next: { date?: string; view?: View }) => {
    const p = new URLSearchParams(params);
    if (next.date) p.set("date", next.date);
    if (next.view) {
      p.set("view", next.view);
      localStorage.setItem(VIEW_KEY, next.view);
    }
    setParams(p, { replace: true });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        t.closest("input, textarea, select, [contenteditable], [role=dialog]")
      )
        return;
      if (e.key === "ArrowLeft") set({ date: addDays(date, -7) });
      else if (e.key === "ArrowRight") set({ date: addDays(date, 7) });
      else if (e.key === "t") set({ date: today });
      else if (e.key === "1") set({ view: "list" });
      else if (e.key === "2") set({ view: "week" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Track</h1>
          <p>Your hours this week. Everything is saved on this computer first, so it works offline too.</p>
        </div>
        <div className="row">
          <Segmented<View>
            label="View"
            value={view}
            onChange={(v) => set({ view: v })}
            options={[
              { value: "list", label: "List", icon: <List /> },
              { value: "week", label: "Week", icon: <Table2 /> },
            ]}
          />
          <Button variant="primary" icon={<Plus />} onClick={() => dialog.open({ date })}>
            Log hours
          </Button>
        </div>
      </div>
      <Reminder today={today} />
      <SubmitCard today={today} />
      <WeekHeader
        days={days}
        entries={entries}
        selected={date}
        onSelect={(d) => set({ date: d })}
        onShift={(w) => set({ date: addDays(date, w * 7) })}
        onToday={() => set({ date: today })}
      />
      {view === "list" && (
        <ListView
          entries={entries}
          onEdit={(e) => dialog.open({ entry: e })}
          onAdd={() => dialog.open({ date })}
          onLogMore={(e) =>
            dialog.open({ date: e.entryDate, combo: { projectId: e.projectId, taskId: null } })
          }
        />
      )}
      {view === "week" && <WeekGrid days={days} entries={entries} />}
    </div>
  );
}
