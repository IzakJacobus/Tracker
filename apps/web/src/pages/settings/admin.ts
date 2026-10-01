import type { Organization, OrgSettings } from "@stint/shared";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "../../app/session.tsx";
import { api, errorMessage } from "../../lib/api.ts";

export type CheckStatus = "ok" | "warning" | "error" | "info";

export interface HealthCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  fix?: { action: string; label: string; args?: Record<string, string> };
}

export interface BackupEntry {
  name: string;
  sizeBytes: number;
  createdAt: number;
}

export interface LastBackup {
  at: number;
  ok: boolean;
  path: string;
  error: string;
  sizeBytes: number;
}

export interface UpdateInfo {
  checkedAt: number;
  current: string;
  latest: string | null;
  available: boolean;
  url: string | null;
  notes: string;
  publishedAt: string | null;
  error?: string;
}

export interface Health {
  status: "ok" | "warning" | "error";
  checkedAt: number;
  checks: HealthCheck[];
  server: {
    version: string;
    startedAt: number;
    hostname: string;
    addresses: string[];
    httpsPort: number | null;
    httpPort: number | null;
    dataDir: string;
    databaseBytes: number;
    freeBytes: number | null;
    platform: string;
  };
  backups: { folder: string; last: LastBackup | null; lastSuccessfulAt: number | null };
  connected: { userId: string; name: string; kind: string; lastSeenAt: number; ip: string }[];
  pairing: { code: string | null; ip: string | null; url: string | null };
  update: UpdateInfo | null;
  platform: {
    checkedAt: number;
    sleepGuard: { active: boolean; method: string | null };
    networks: { name: string; interfaceAlias: string; category: string }[];
    firewall: { checked: boolean; rules: { name: string; enabled: boolean; profile: string }[] };
    tailscale: { installed: boolean; running: boolean; dnsName: string | null; ips: string[] };
  } | null;
}

/** GET with loading/error state and a reload function. */
export function useAdminGet<T>(path: string, intervalMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setData(await api.get<T>(path));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [path]);
  useEffect(() => {
    void reload();
    if (!intervalMs) return;
    const t = setInterval(() => void reload(), intervalMs);
    return () => clearInterval(t);
  }, [reload, intervalMs]);
  return { data, setData, error, reload };
}

/** Saves part of the organisation settings and refreshes the session's copy. */
export function useSaveSettings() {
  const { refresh } = useSession();
  return useCallback(
    async (patch: Partial<OrgSettings>) => {
      const org = await api.patch<Organization>("/org", { settings: patch });
      await refresh();
      return org;
    },
    [refresh],
  );
}

export function fmtBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

export function fmtWhen(ms: number | null | undefined, timeZone: string): string {
  if (!ms) return "never";
  return new Intl.DateTimeFormat("en-ZA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(ms)
    .replace(/\//g, "-")
    .replace(",", "");
}

export function fmtAgo(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}
