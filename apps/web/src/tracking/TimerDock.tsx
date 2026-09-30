import { formatDuration } from "@stint/shared";
import { CircleDollarSign, Play, Plus, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useData } from "../data/DataProvider.tsx";
import { Button } from "../ui/Button.tsx";
import { useToast } from "../ui/Toast.tsx";
import { type Combo, useNow, useRunningEntry } from "./hooks.ts";
import { ProjectPicker } from "./ProjectPicker.tsx";
import { TagPicker } from "./TagPicker.tsx";

export const TIMER_EVENTS = new EventTarget();
/** Other parts of the app (shortcuts, command palette, tray) can toggle the timer. */
export function requestTimerToggle() {
  TIMER_EVENTS.dispatchEvent(new Event("toggle"));
}
export function requestTimerStart(combo: Combo) {
  TIMER_EVENTS.dispatchEvent(new CustomEvent("start", { detail: combo }));
}

/**
 * The always-visible timer. When idle it doubles as a quick "what's next?" form;
 * when running every field edits the live entry directly.
 */
export function TimerDock({ onAddManual }: { onAddManual: () => void }) {
  const { entries } = useData();
  const toast = useToast();
  const running = useRunningEntry();
  const now = useNow(1000);
  const [draft, setDraft] = useState<{
    combo: Combo | null;
    description: string;
    tagIds: string[];
    billable: boolean | null;
  }>({
    combo: null,
    description: "",
    tagIds: [],
    billable: null,
  });
  const descRef = useRef<HTMLInputElement>(null);

  const combo = running ? { projectId: running.projectId, taskId: running.taskId } : draft.combo;
  const description = running ? running.description : draft.description;
  const tagIds = running ? running.tagIds : draft.tagIds;
  const billable = running ? running.billable : draft.billable;

  async function start(c: Combo | null = combo) {
    if (!c) {
      toast.show("Choose a project first.");
      document.getElementById("dock-project")?.click();
      return;
    }
    await entries.start({
      projectId: c.projectId,
      taskId: c.taskId,
      description: draft.description,
      tagIds: draft.tagIds,
      billable: draft.billable ?? undefined,
    });
    setDraft({ combo: c, description: "", tagIds: [], billable: null });
  }

  async function stop() {
    const e = await entries.stop();
    if (e) toast.show(`Stopped · ${formatDuration(e.durationS ?? 0)} saved`, { kind: "success" });
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: listeners call the latest start/stop via closure refresh
  useEffect(() => {
    const onToggle = () => void (running ? stop() : start());
    const onStart = (e: Event) => void start((e as CustomEvent<Combo>).detail);
    TIMER_EVENTS.addEventListener("toggle", onToggle);
    TIMER_EVENTS.addEventListener("start", onStart);
    return () => {
      TIMER_EVENTS.removeEventListener("toggle", onToggle);
      TIMER_EVENTS.removeEventListener("start", onStart);
    };
  }, [running, draft]);

  const elapsed = running ? Math.max(0, Math.floor((now - running.startedAt) / 1000)) : 0;

  useEffect(() => {
    document.title = running ? `${formatDuration(elapsed, true)} · Stint` : "Stint";
  }, [running, elapsed]);

  return (
    <section className="dock" data-running={running ? true : undefined} aria-label="Timer">
      <div className="dock__inner">
        <input
          ref={descRef}
          className="dock__desc"
          placeholder={running ? "What are you working on?" : "What are you working on next?"}
          aria-label="Description"
          value={description}
          onChange={(e) => {
            if (running) void entries.update(running.id, { description: e.target.value });
            else setDraft({ ...draft, description: e.target.value });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !running) void start();
          }}
        />
        <div className="dock__project">
          <ProjectPicker
            id="dock-project"
            value={combo}
            placement="top-start"
            onChange={async (c) => {
              if (running) {
                await entries.update(running.id, {
                  projectId: c.projectId,
                  taskId: c.taskId,
                  billable: await entries.billableFor(c.projectId, c.taskId),
                });
              } else setDraft({ ...draft, combo: c });
            }}
          />
        </div>
        <div className="dock__tools">
          <TagPicker
            value={tagIds}
            onChange={(ids) => {
              if (running) void entries.update(running.id, { tagIds: ids });
              else setDraft({ ...draft, tagIds: ids });
            }}
          />
          <Button
            variant="ghost"
            iconOnly
            label={
              billable === false
                ? "Non-billable (click to make billable)"
                : "Billable (click to make non-billable)"
            }
            aria-pressed={billable !== false}
            className={billable === false ? "billable-toggle" : "billable-toggle billable-toggle--on"}
            icon={<CircleDollarSign />}
            onClick={() => {
              const next = billable === false;
              if (running) void entries.update(running.id, { billable: next });
              else setDraft({ ...draft, billable: next });
            }}
          />
        </div>
        <div
          className="dock__time mono"
          role="timer"
          aria-live="off"
          aria-label={running ? `Running for ${formatDuration(elapsed, true)}` : "Timer stopped"}
        >
          {formatDuration(elapsed, true)}
        </div>
        {running ? (
          <button
            type="button"
            className="dock__go dock__go--stop"
            onClick={() => void stop()}
            aria-label="Stop timer"
            title="Stop (S)"
          >
            <Square />
          </button>
        ) : (
          <button
            type="button"
            className="dock__go"
            onClick={() => void start()}
            aria-label="Start timer"
            title="Start (S)"
          >
            <Play />
          </button>
        )}
        <Button
          variant="ghost"
          iconOnly
          label="Add time manually (N)"
          icon={<Plus />}
          onClick={onAddManual}
          className="dock__manual"
        />
      </div>
    </section>
  );
}
