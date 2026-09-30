import { hostname, networkInterfaces } from "node:os";

const VIRTUAL_IFACE =
  /vethernet|virtualbox|vmware|docker|br-|veth|hyper-v|wsl|loopback|tailscale|zerotier|utun/i;

/** IPv4 addresses of this machine (excludes loopback / link-local), physical adapters first. */
export function lanAddresses(): string[] {
  const physical: string[] = [];
  const virtual: string[] = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== "IPv4" || a.internal || a.address.startsWith("169.254.")) continue;
      (VIRTUAL_IFACE.test(name) ? virtual : physical).push(a.address);
    }
  }
  return [...new Set([...physical.sort(), ...virtual.sort()])];
}

function isPrivate(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b !== undefined && b >= 16 && b <= 31);
}

/** The address most likely to be reachable by other office PCs. */
export function primaryAddress(addresses: string[]): string | null {
  return (
    addresses.find((a) => isPrivate(a) && !isTailscaleAddress(a)) ??
    addresses.find((a) => !isTailscaleAddress(a)) ??
    addresses[0] ??
    null
  );
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
