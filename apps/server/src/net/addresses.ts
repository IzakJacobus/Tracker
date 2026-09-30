import { hostname, networkInterfaces } from "node:os";

/** Private IPv4 addresses of this machine (excludes loopback / link-local). */
export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === "IPv4" && !a.internal && !a.address.startsWith("169.254.")) out.push(a.address);
    }
  }
  return [...new Set(out)].sort();
}

export function machineName(): string {
  return hostname().replace(/\.local$/i, "");
}

export function isLoopback(ip: string | undefined): boolean {
  if (!ip) return false;
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1" || ip.startsWith("127.");
}

/** Tailscale's CGNAT range 100.64.0.0/10 */
export function isTailscaleAddress(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return a === 100 && b !== undefined && b >= 64 && b <= 127;
}
