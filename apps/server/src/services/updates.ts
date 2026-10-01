import type { AppContext } from "../context.ts";
import { getMeta, setMeta } from "../lib/meta.ts";

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

/** Compares dotted versions ("1.2.10" > "1.2.9"); a pre-release sorts before its release. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core = "", pre = ""] = v.replace(/^v/i, "").split("-", 2);
    return { parts: core.split(".").map((n) => Number.parseInt(n, 10) || 0), pre };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.parts.length, y.parts.length); i++) {
    const d = (x.parts[i] ?? 0) - (y.parts[i] ?? 0);
    if (d) return Math.sign(d);
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}

export function storedUpdateInfo(ctx: Pick<AppContext, "db" | "version">): UpdateInfo | null {
  const raw = getMeta(ctx.db, "update_info");
  if (!raw) return null;
  const info = JSON.parse(raw) as UpdateInfo;
  // After an upgrade the stored result is stale until the next check.
  return {
    ...info,
    current: ctx.version,
    available: !!info.latest && compareVersions(info.latest, ctx.version) > 0,
  };
}

/** Asks GitHub Releases for the newest published version. Only the version is sent: no data leaves the office. */
export async function checkForUpdate(
  ctx: Pick<AppContext, "db" | "config" | "version" | "now" | "log">,
  fetchImpl: typeof fetch = fetch,
): Promise<UpdateInfo> {
  const base: UpdateInfo = {
    checkedAt: ctx.now(),
    current: ctx.version,
    latest: null,
    available: false,
    url: null,
    notes: "",
    publishedAt: null,
  };
  let info: UpdateInfo;
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${ctx.config.updateRepo}/releases/latest`, {
      headers: { accept: "application/vnd.github+json", "user-agent": `stint-server/${ctx.version}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 404) {
      info = { ...base };
    } else if (!res.ok) {
      throw new Error(`GitHub answered ${res.status}`);
    } else {
      const r = (await res.json()) as {
        tag_name: string;
        html_url: string;
        body?: string;
        published_at?: string;
      };
      const latest = r.tag_name.replace(/^v/i, "");
      info = {
        ...base,
        latest,
        available: compareVersions(latest, ctx.version) > 0,
        url: r.html_url,
        notes: (r.body ?? "").slice(0, 4000),
        publishedAt: r.published_at ?? null,
      };
    }
  } catch (e) {
    const prev = storedUpdateInfo(ctx);
    info = { ...(prev ?? base), checkedAt: ctx.now(), error: (e as Error).message };
  }
  setMeta(ctx.db, "update_info", JSON.stringify(info));
  if (info.available) ctx.log.info("A Stint update is available", { latest: info.latest });
  return info;
}

/** Checks once a day (first check a few minutes after start). */
export function startUpdateChecks(ctx: AppContext): () => void {
  if (!ctx.config.updateCheck) return () => {};
  const tick = () => {
    const last = storedUpdateInfo(ctx)?.checkedAt ?? 0;
    if (ctx.now() - last > 23 * 3600_000) void checkForUpdate(ctx);
  };
  const first = setTimeout(tick, 3 * 60_000);
  const t = setInterval(tick, 3600_000);
  return () => {
    clearTimeout(first);
    clearInterval(t);
  };
}
