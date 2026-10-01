import { powershellJson, run } from "./exec.ts";

export type NetworkCategory = "Public" | "Private" | "DomainAuthenticated";

export interface NetworkProfile {
  name: string;
  interfaceAlias: string;
  category: NetworkCategory;
}

interface RawProfile {
  Name: string;
  InterfaceAlias: string;
  NetworkCategory: number | string;
}

const CATEGORY: Record<string, NetworkCategory> = {
  "0": "Public",
  "1": "Private",
  "2": "DomainAuthenticated",
};

/** Windows network profiles (Public / Private / Domain). Empty elsewhere or if PowerShell fails. */
export async function networkProfiles(): Promise<NetworkProfile[]> {
  if (process.platform !== "win32") return [];
  const raw = await powershellJson<RawProfile | RawProfile[]>(
    "Get-NetConnectionProfile | Select-Object Name,InterfaceAlias,NetworkCategory | ConvertTo-Json -Compress",
  );
  if (!raw) return [];
  return (Array.isArray(raw) ? raw : [raw]).map((p) => ({
    name: p.Name,
    interfaceAlias: p.InterfaceAlias,
    category: CATEGORY[String(p.NetworkCategory)] ?? (String(p.NetworkCategory) as NetworkCategory),
  }));
}

/** The plain-language warning shown on the Health page and pairing screen, or null when all is well. */
export function networkWarningFor(profiles: NetworkProfile[]): string | null {
  const pub = profiles.filter((p) => p.category === "Public");
  if (!pub.length) return null;
  const names = pub.map((p) => `"${p.name}"`).join(", ");
  return `Windows treats the network ${names} as Public, so other PCs can't reach Stint. If this is your office network, mark it as Private.`;
}

/** Marks a network as Private. Works because the service runs with administrator rights. */
export async function makeNetworkPrivate(interfaceAlias: string): Promise<boolean> {
  if (process.platform !== "win32") return false;
  const alias = interfaceAlias.replace(/'/g, "''");
  const r = await run([
    "powershell.exe",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `Set-NetConnectionProfile -InterfaceAlias '${alias}' -NetworkCategory Private`,
  ]);
  return r.code === 0;
}

export interface FirewallStatus {
  checked: boolean;
  /** Rules found that allow Stint on Private/Domain networks. */
  rules: { name: string; enabled: boolean; profile: string }[];
}

/** Checks the firewall rules the installer adds ("Stint Server …"). */
export async function firewallStatus(): Promise<FirewallStatus> {
  if (process.platform !== "win32") return { checked: false, rules: [] };
  const raw = await powershellJson<
    | { DisplayName: string; Enabled: number | boolean; Profile: number | string }
    | { DisplayName: string; Enabled: number | boolean; Profile: number | string }[]
  >(
    "Get-NetFirewallRule -DisplayName 'Stint Server*' -ErrorAction SilentlyContinue | Select-Object DisplayName,Enabled,Profile | ConvertTo-Json -Compress",
  );
  const list = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
  return {
    checked: true,
    rules: list.map((r) => ({
      name: r.DisplayName,
      enabled: r.Enabled === true || r.Enabled === 1,
      profile: String(r.Profile),
    })),
  };
}
