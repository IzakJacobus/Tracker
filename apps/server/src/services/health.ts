import { statfsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AppContext } from "../context.ts";
import { pairingInfo } from "../routes/pairing.ts";
import { backupFolder, lastBackup, lastSuccessfulBackup } from "./backup.ts";
import { getOrgSettings } from "./org.ts";
import { storedUpdateInfo } from "./updates.ts";

export type CheckStatus = "ok" | "warning" | "error" | "info";

export interface HealthCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  /** A one-click fix the Health page can offer. */
  fix?: { action: string; label: string; args?: Record<string, string> };
}

const DAY = 86_400_000;

function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function freeBytes(path: string): number | null {
  try {
    const s = statfsSync(path);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

const gb = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GB`;

export function healthReport(ctx: AppContext) {
  const now = ctx.now();
  const settings = getOrgSettings(ctx.db);
  const checks: HealthCheck[] = [];
  const dbPath = join(ctx.config.dataDir, "stint.db");
  const dbSize = fileSize(dbPath) + fileSize(`${dbPath}-wal`);

  const quick = ctx.db.query<{ quick_check: string }, []>("PRAGMA quick_check").get()?.quick_check;
  checks.push(
    quick === "ok"
      ? {
          id: "database",
          label: "Database",
          status: "ok",
          detail: `Healthy (${(dbSize / 1024 ** 2).toFixed(1)} MB).`,
        }
      : {
          id: "database",
          label: "Database",
          status: "error",
          detail: `SQLite reports a problem: ${quick}. Restore the latest backup from Settings → Backups.`,
        },
  );

  const last = lastBackup(ctx.db);
  const lastOk = lastSuccessfulBackup(ctx.db);
  const folder = backupFolder(ctx);
  if (last && !last.ok) {
    checks.push({
      id: "backup",
      label: "Backups",
      status: "error",
      detail: `The last backup failed: ${last.error}`,
      fix: { action: "backup_now", label: "Try again" },
    });
  } else if (!lastOk) {
    checks.push({
      id: "backup",
      label: "Backups",
      status: "warning",
      detail: `No backup yet. The first one runs at ${settings.backup.time}.`,
      fix: { action: "backup_now", label: "Back up now" },
    });
  } else if (now - lastOk > 1.5 * DAY) {
    checks.push({
      id: "backup",
      label: "Backups",
      status: "warning",
      detail: `The last backup was ${Math.floor((now - lastOk) / DAY)} days ago.`,
      fix: { action: "backup_now", label: "Back up now" },
    });
  } else {
    checks.push({
      id: "backup",
      label: "Backups",
      status: "ok",
      detail: `Last backup ${new Date(lastOk).toISOString()}.`,
    });
  }
  if (!settings.backup.folder) {
    checks.push({
      id: "backup_location",
      label: "Backup location",
      status: "warning",
      detail:
        "Backups are kept on this PC only. If its disk fails they are lost too — choose a USB drive or OneDrive folder.",
      fix: { action: "open_backups", label: "Choose a folder" },
    });
  }

  const free = freeBytes(ctx.config.dataDir);
  if (free !== null) {
    checks.push(
      free < 1024 ** 3
        ? {
            id: "disk",
            label: "Disk space",
            status: "error",
            detail: `Only ${gb(free)} free on the server PC.`,
          }
        : free < 5 * 1024 ** 3
          ? {
              id: "disk",
              label: "Disk space",
              status: "warning",
              detail: `${gb(free)} free on the server PC.`,
            }
          : { id: "disk", label: "Disk space", status: "ok", detail: `${gb(free)} free.` },
    );
  }

  const p = ctx.runtime.platform;
  if (ctx.runtime.networkWarning) {
    const pub = p?.networks.find((n) => n.category === "Public");
    checks.push({
      id: "network",
      label: "Network",
      status: "warning",
      detail: ctx.runtime.networkWarning,
      fix: pub
        ? { action: "make_private", label: "Mark as Private", args: { interfaceAlias: pub.interfaceAlias } }
        : undefined,
    });
  } else {
    checks.push({
      id: "network",
      label: "Network",
      status: ctx.runtime.addresses.length ? "ok" : "error",
      detail: ctx.runtime.addresses.length
        ? `Reachable at ${ctx.runtime.addresses.join(", ")} (port ${ctx.runtime.httpsPort}).`
        : "This PC has no network address. Check the cable or Wi-Fi.",
    });
  }

  if (p?.firewall.checked) {
    const ok = p.firewall.rules.some((r) => r.enabled);
    checks.push({
      id: "firewall",
      label: "Firewall",
      status: ok ? "ok" : "error",
      detail: ok
        ? "Windows Firewall allows Stint on Private and Domain networks."
        : "The Stint firewall rule is missing, so other PCs can't connect. Re-run the Stint Server installer to repair it.",
    });
  }

  const wantGuard = ctx.config.sleepGuard && settings.sleepGuard;
  checks.push({
    id: "sleep",
    label: "Sleep prevention",
    status: !wantGuard ? "info" : p?.sleepGuard.active ? "ok" : p ? "warning" : "info",
    detail: !wantGuard
      ? "Off. If this PC sleeps, timers can't sync until it wakes."
      : p?.sleepGuard.active
        ? "This PC is kept awake while Stint Server runs (the screen can still turn off)."
        : "Couldn't stop this PC from sleeping. Set its power plan to never sleep.",
  });

  if (settings.remoteAccess.enabled) {
    const ts = p?.tailscale;
    checks.push({
      id: "remote",
      label: "Remote access",
      status: ts?.running ? "ok" : "warning",
      detail: ts?.running
        ? `Tailscale is connected: ${ts.dnsName ?? ts.ips.join(", ")}.`
        : ts?.installed
          ? "Tailscale is installed but not connected. Open Tailscale on this PC and sign in."
          : "Tailscale isn't installed on this PC. See Settings → Remote access.",
    });
  }

  const certExp = ctx.runtime.certificateExpiresAt;
  if (certExp) {
    checks.push(
      certExp - now < 30 * DAY
        ? {
            id: "certificate",
            label: "Certificate",
            status: "warning",
            detail:
              "The server certificate expires soon. Restart Stint Server (or the PC) to renew it automatically.",
          }
        : {
            id: "certificate",
            label: "Certificate",
            status: "ok",
            detail: `Valid until ${new Date(certExp).toISOString().slice(0, 10)}.`,
          },
    );
  }

  const update = storedUpdateInfo(ctx);
  if (update?.available) {
    checks.push({
      id: "update",
      label: "Updates",
      status: "info",
      detail: `Stint ${update.latest} is available (you have ${ctx.version}).`,
      fix: update.url
        ? { action: "open_url", label: "See what's new", args: { url: update.url } }
        : undefined,
    });
  }

  const connected = ctx.db
    .query<{ id: string; name: string; kind: string; last_seen_at: number; ip: string }, [number]>(
      `SELECT u.id, u.name, s.kind, MAX(s.last_seen_at) AS last_seen_at, s.ip
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.last_seen_at > ? GROUP BY u.id, s.kind ORDER BY u.name`,
    )
    .all(now - 10 * 60_000)
    .map((r) => ({ userId: r.id, name: r.name, kind: r.kind, lastSeenAt: r.last_seen_at, ip: r.ip }));

  const rank: Record<CheckStatus, number> = { ok: 0, info: 0, warning: 1, error: 2 };
  const worst = checks.reduce((w, c) => Math.max(w, rank[c.status]), 0);
  return {
    status: (["ok", "warning", "error"] as const)[worst],
    checkedAt: now,
    checks,
    server: {
      version: ctx.version,
      startedAt: ctx.runtime.startedAt,
      hostname: ctx.runtime.hostname,
      addresses: ctx.runtime.addresses,
      httpsPort: ctx.runtime.httpsPort,
      httpPort: ctx.runtime.httpPort,
      dataDir: ctx.config.dataDir,
      databaseBytes: dbSize,
      freeBytes: free,
      platform: process.platform,
    },
    backups: { folder, last, lastSuccessfulAt: lastOk },
    connected,
    pairing: pairingInfo(ctx),
    update,
    platform: p ?? null,
  };
}
