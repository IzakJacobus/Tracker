import { existsSync } from "node:fs";
import { run } from "./exec.ts";

export interface TailscaleStatus {
  installed: boolean;
  running: boolean;
  /** MagicDNS name, e.g. office-pc.tail1234.ts.net */
  dnsName: string | null;
  ips: string[];
}

function binary(): string | null {
  if (process.platform === "win32") {
    const p = `${process.env.ProgramFiles ?? "C:\\Program Files"}\\Tailscale\\tailscale.exe`;
    return existsSync(p) ? p : Bun.which("tailscale");
  }
  if (process.platform === "darwin" && existsSync("/Applications/Tailscale.app/Contents/MacOS/Tailscale")) {
    return "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
  }
  return Bun.which("tailscale");
}

/** Reads `tailscale status --json`. Stint never changes Tailscale settings itself. */
export async function tailscaleStatus(): Promise<TailscaleStatus> {
  const bin = binary();
  if (!bin) return { installed: false, running: false, dnsName: null, ips: [] };
  const r = await run([bin, "status", "--json"], { timeoutMs: 10_000 });
  if (r.code !== 0) return { installed: true, running: false, dnsName: null, ips: [] };
  try {
    const s = JSON.parse(r.stdout) as {
      BackendState?: string;
      Self?: { DNSName?: string; TailscaleIPs?: string[] };
    };
    return {
      installed: true,
      running: s.BackendState === "Running",
      dnsName: s.Self?.DNSName ? s.Self.DNSName.replace(/\.$/, "") : null,
      ips: (s.Self?.TailscaleIPs ?? []).filter((ip) => ip.includes(".")),
    };
  } catch {
    return { installed: true, running: false, dnsName: null, ips: [] };
  }
}
