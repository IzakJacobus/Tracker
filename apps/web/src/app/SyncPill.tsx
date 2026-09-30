import { AlertTriangle, CheckCircle2, CloudOff, Loader2, RefreshCw } from "lucide-react";
import { useRef, useState } from "react";
import { useData, useSyncStatus } from "../data/DataProvider.tsx";
import { Button } from "../ui/Button.tsx";
import { Popover } from "../ui/Popover.tsx";

function ago(ts: number | null): string {
  if (!ts) return "never";
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Always-visible sync status: synced / pending / offline / error. */
export function SyncPill() {
  const status = useSyncStatus();
  const { engine } = useData();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  const view = {
    synced: { icon: <CheckCircle2 />, label: "Synced", tone: "primary" },
    syncing: { icon: <Loader2 className="spin" />, label: "Syncing…", tone: "" },
    pending: { icon: <RefreshCw />, label: `${status.pending} pending`, tone: "live" },
    offline: {
      icon: <CloudOff />,
      label: status.pending ? `Offline · ${status.pending} saved` : "Offline",
      tone: "warning",
    },
    error: { icon: <AlertTriangle />, label: "Sync problem", tone: "danger" },
  }[status.state];

  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={`sync-pill sync-pill--${view.tone || "neutral"}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Sync status: ${view.label}`}
      >
        {view.icon}
        <span className="sync-pill__label">{view.label}</span>
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchor={anchor}
        placement="top-start"
        label="Sync details"
      >
        <div className="stack stack--sm" style={{ padding: 12, maxWidth: 320 }}>
          <strong>{view.label}</strong>
          <p className="muted" style={{ fontSize: "var(--text-sm)" }}>
            {status.state === "offline"
              ? "Can't reach the Stint server right now. Keep working — your changes are saved on this computer and will be sent automatically when the connection is back."
              : status.state === "error"
                ? (status.error ?? "Something went wrong while syncing.")
                : status.pending
                  ? "Some changes are waiting to be sent to the server."
                  : "Everything on this computer matches the server."}
          </p>
          <p className="subtle" style={{ fontSize: "var(--text-xs)" }}>
            Last synced {ago(status.lastSyncedAt)}
          </p>
          {status.rejected.length > 0 && (
            <div className="stack stack--sm">
              <strong style={{ fontSize: "var(--text-sm)" }}>Changes the server didn't accept</strong>
              {status.rejected.slice(0, 5).map((r) => (
                <div key={r.at} style={{ fontSize: "var(--text-sm)" }}>
                  {r.message}
                </div>
              ))}
            </div>
          )}
          <div>
            <Button size="sm" icon={<RefreshCw />} onClick={() => void engine.syncNow()}>
              Sync now
            </Button>
          </div>
        </div>
      </Popover>
    </>
  );
}
