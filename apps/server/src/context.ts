import type { Database } from "bun:sqlite";
import type { LoginLimiter } from "./auth/rateLimit.ts";
import type { ServerConfig } from "./config.ts";
import type { Logger } from "./lib/log.ts";

/** Everything a request handler needs. Tests build one with an in-memory DB and a fake clock. */
export interface AppContext {
  db: Database;
  config: ServerConfig;
  log: Logger;
  now: () => number;
  version: string;
  limiter: LoginLimiter;
  /** Runtime network facts, filled in by the network layer. */
  runtime: RuntimeInfo;
  /** Hooks provided by the host process (backups, discovery, …). Optional in tests. */
  services: Partial<HostServices>;
}

export interface RuntimeInfo {
  startedAt: number;
  httpsPort: number | null;
  httpPort: number | null;
  addresses: string[];
  hostname: string;
  caFingerprint: string | null;
}

export interface HostServices {
  runBackup(
    kind: "manual" | "scheduled" | "pre-migration" | "pre-restore",
  ): Promise<{ ok: boolean; path?: string; error?: string }>;
}

/** Per-request variables set by middleware. */
export interface RequestEnv {
  ip?: string;
  loopback?: boolean;
}
