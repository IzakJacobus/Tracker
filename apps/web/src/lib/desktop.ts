import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { tauri } from "./transport.ts";

export const isDesktop = () => tauri() !== null;

export interface FoundServer {
  id: string;
  name: string;
  version: string;
  fingerprint: string;
  addresses: string[];
  via: string;
}

export interface PairingStatus {
  id: string;
  name: string;
  addresses: string[];
  fingerprint: string;
}

export const desktop = {
  pairingStatus: () => invoke<PairingStatus | null>("pairing_status"),
  discover: (timeoutMs = 2500) => invoke<FoundServer[]>("discover_servers", { timeoutMs }),
  pairDiscovered: (found: FoundServer) => invoke<PairingStatus>("pair_discovered", { found }),
  pairWithCode: (code: string) => invoke<PairingStatus>("pair_with_code", { code }),
  unpair: () => invoke<void>("unpair"),
  idleSeconds: () => invoke<number>("idle_seconds"),
  trayUpdate: (running: boolean, tooltip: string) => invoke<void>("tray_update", { running, tooltip }),
  notify: (title: string, body: string) => invoke<void>("notify", { title, body }),
  autostartEnabled: () => invoke<boolean>("plugin:autostart|is_enabled"),
  setAutostart: (on: boolean) => invoke<void>(on ? "plugin:autostart|enable" : "plugin:autostart|disable"),
  onTrayToggle: (fn: () => void): Promise<UnlistenFn> => listen("stint://tray-toggle", fn),
};
