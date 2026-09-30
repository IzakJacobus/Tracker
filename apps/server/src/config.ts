import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";

export const ConfigSchema = z.object({
  /** Where the database, certificates, logs and runtime state live. */
  dataDir: z.string().min(1),
  /** Preferred HTTPS port for the LAN. The next free port is used if it is busy. */
  port: z.number().int().min(1).max(65535).default(47600),
  /** Preferred plain-HTTP port, bound to 127.0.0.1 only (setup wizard / admin on the server PC). */
  httpPort: z.number().int().min(1).max(65535).default(47601),
  /** UDP port for the broadcast discovery fallback. */
  discoveryPort: z.number().int().min(1).max(65535).default(47609),
  discovery: z.boolean().default(true),
  sleepGuard: z.boolean().default(true),
  /** Open the admin page in a browser on first start (setup not complete). */
  openBrowser: z.boolean().default(true),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  /** Serve the web client from this folder instead of the embedded copy (development). */
  webDir: z.string().nullable().default(null),
  /** GitHub "owner/repo" used for update checks. */
  updateRepo: z.string().default("IzakJacobus/Tracker"),
  updateCheck: z.boolean().default(true),
});
export type ServerConfig = z.infer<typeof ConfigSchema>;

export function defaultDataDir(): string {
  if (process.env.STINT_DATA_DIR) return resolve(process.env.STINT_DATA_DIR);
  if (process.platform === "win32") return join(process.env.ProgramData ?? "C:\\ProgramData", "Stint");
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "Stint Server");
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "stint-server");
}

const bool = (v: string | undefined) =>
  v === undefined ? undefined : ["1", "true", "yes", "on"].includes(v.toLowerCase());
const int = (v: string | undefined) => (v === undefined || v === "" ? undefined : Number(v));

/** Defaults < `<dataDir>/stint.config.json` < environment variables. */
export function loadConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const dataDir = env.STINT_DATA_DIR ? resolve(env.STINT_DATA_DIR) : defaultDataDir();
  const file = join(dataDir, "stint.config.json");
  let fromFile: Record<string, unknown> = {};
  if (existsSync(file)) {
    try {
      fromFile = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    } catch (e) {
      throw new Error(`Could not read ${file}: ${(e as Error).message}`);
    }
  }
  const fromEnv = Object.fromEntries(
    Object.entries({
      port: int(env.STINT_PORT),
      httpPort: int(env.STINT_HTTP_PORT),
      discoveryPort: int(env.STINT_DISCOVERY_PORT),
      discovery: env.STINT_DISABLE_DISCOVERY !== undefined ? !bool(env.STINT_DISABLE_DISCOVERY) : undefined,
      sleepGuard:
        env.STINT_DISABLE_SLEEP_GUARD !== undefined ? !bool(env.STINT_DISABLE_SLEEP_GUARD) : undefined,
      openBrowser: bool(env.STINT_OPEN_BROWSER),
      logLevel: env.STINT_LOG_LEVEL,
      webDir: env.STINT_WEB_DIR,
      updateCheck:
        env.STINT_DISABLE_UPDATE_CHECK !== undefined ? !bool(env.STINT_DISABLE_UPDATE_CHECK) : undefined,
    }).filter(([, v]) => v !== undefined),
  );
  return ConfigSchema.parse({ ...fromFile, ...fromEnv, dataDir });
}
