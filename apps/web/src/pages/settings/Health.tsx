import { AlertCircle, AlertTriangle, CheckCircle2, Info, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { useMe } from "../../app/session.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import { Button } from "../../ui/Button.tsx";
import { Alert, Badge } from "../../ui/misc.tsx";
import { useToast } from "../../ui/Toast.tsx";
import { ConnectPanel } from "../auth/ConnectPanel.tsx";
import {
  type CheckStatus,
  fmtAgo,
  fmtBytes,
  fmtWhen,
  type Health,
  type HealthCheck,
  useAdminGet,
} from "./admin.ts";

const ICON: Record<CheckStatus, typeof Info> = {
  ok: CheckCircle2,
  info: Info,
  warning: AlertTriangle,
  error: AlertCircle,
};

const SUMMARY = {
  ok: { tone: "success", title: "Everything is working" },
  warning: { tone: "warning", title: "Stint is working, but needs attention" },
  error: { tone: "danger", title: "Something needs fixing" },
} as const;

function uptime(ms: number): string {
  const h = Math.floor(ms / 3600_000);
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60_000))} min`;
  if (h < 48) return `${h} h`;
  return `${Math.floor(h / 24)} days`;
}

/** The Health page: a plain-language view of whether the server is OK, and one-click fixes. */
export function HealthPage() {
  const me = useMe();
  const tz = me.organization?.settings.timezone ?? "Africa/Johannesburg";
  const { data: h, setData, error, reload } = useAdminGet<Health>("/admin/health", 30_000);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const navigate = useNavigate();

  async function act(key: string, fn: () => Promise<unknown>, done?: string) {
    setBusy(key);
    try {
      await fn();
      if (done) toast.success(done);
      await reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  function fix(c: HealthCheck) {
    const f = c.fix;
    if (!f) return null;
    if (f.action === "open_url" && f.args?.url) {
      return (
        <a className="btn btn--sm" href={f.args.url} target="_blank" rel="noreferrer">
          {f.label}
        </a>
      );
    }
    const run = () => {
      if (f.action === "backup_now") void act(c.id, () => api.post("/admin/backups/run"), "Backup finished.");
      else if (f.action === "open_backups") navigate("/settings/backups");
      else if (f.action === "make_private")
        void act(
          c.id,
          () => api.post("/admin/network/private", { interfaceAlias: f.args?.interfaceAlias }),
          "The network is now Private.",
        );
    };
    return (
      <Button size="sm" loading={busy === c.id} onClick={run}>
        {f.label}
      </Button>
    );
  }

  if (!h) return error ? <Alert tone="danger">{error}</Alert> : null;
  const summary = SUMMARY[h.status];

  return (
    <div className="stack stack--lg" style={{ maxWidth: 960 }}>
      <Alert
        tone={summary.tone}
        title={summary.title}
        action={
          <Button
            size="sm"
            variant="ghost"
            icon={<RefreshCw />}
            loading={busy === "refresh"}
            onClick={() =>
              void act("refresh", async () => setData(await api.post<Health>("/admin/health/refresh")))
            }
          >
            Check again
          </Button>
        }
      >
        Checked {fmtAgo(h.checkedAt)}.
      </Alert>

      <section className="card" aria-labelledby="checks-h">
        <div className="card__header">
          <h2 id="checks-h">Checks</h2>
        </div>
        <ul className="health-list">
          {h.checks.map((c) => {
            const Icon = ICON[c.status];
            return (
              <li key={c.id} className={`health-item health-item--${c.status}`}>
                <Icon aria-hidden="true" className="health-item__icon" />
                <div className="grow">
                  <div className="health-item__label">
                    {c.label}
                    <span className="sr-only"> — {c.status}</span>
                  </div>
                  <div className="health-item__detail">{c.detail}</div>
                </div>
                {fix(c)}
              </li>
            );
          })}
        </ul>
      </section>

      <div className="health-grid">
        <section className="card card__body stack" aria-labelledby="pair-h">
          <h2 id="pair-h">Open Stint on other computers</h2>
          <p className="muted">
            People open Stint in their web browser. Nothing needs installing on their computers.
          </p>
          <ConnectPanel onHealthPage />
        </section>

        <section className="card card__body stack" aria-labelledby="who-h">
          <h2 id="who-h">Connected now</h2>
          {h.connected.length === 0 ? (
            <p className="muted">Nobody has synced in the last 10 minutes.</p>
          ) : (
            <ul className="plain-list">
              {h.connected.map((c) => (
                <li key={`${c.userId}-${c.kind}`} className="row row--between">
                  <span>{c.name}</span>
                  <span className="muted">{fmtAgo(c.lastSeenAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card card__body stack" aria-labelledby="server-h">
        <div className="row row--between">
          <h2 id="server-h">Server</h2>
          <Button
            size="sm"
            variant="ghost"
            loading={busy === "update"}
            onClick={() => void act("update", () => api.post("/admin/updates/check"))}
          >
            Check for updates
          </Button>
        </div>
        <dl className="kv">
          <dt>Version</dt>
          <dd>
            {h.server.version}
            {h.update?.available && (
              <>
                {" "}
                <Badge tone="info">{h.update.latest} available</Badge>
              </>
            )}
            {h.update && !h.update.available && !h.update.error && (
              <span className="muted"> · up to date (checked {fmtAgo(h.update.checkedAt)})</span>
            )}
            {h.update?.error && (
              <span className="muted"> · couldn't check for updates: {h.update.error}</span>
            )}
          </dd>
          <dt>Computer</dt>
          <dd>{h.server.hostname}</dd>
          <dt>Addresses</dt>
          <dd className="mono">
            {h.server.addresses.join(", ") || "none"} · port {h.server.httpsPort}
          </dd>
          <dt>Running for</dt>
          <dd>{uptime(Date.now() - h.server.startedAt)}</dd>
          <dt>Data folder</dt>
          <dd className="mono">{h.server.dataDir}</dd>
          <dt>Database</dt>
          <dd>
            {fmtBytes(h.server.databaseBytes)} · {fmtBytes(h.server.freeBytes)} free
          </dd>
          <dt>Last backup</dt>
          <dd>{fmtWhen(h.backups.lastSuccessfulAt, tz)}</dd>
        </dl>
      </section>
    </div>
  );
}
