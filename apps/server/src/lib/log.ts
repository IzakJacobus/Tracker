import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";
const order: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(msg: string, data?: unknown): void;
  info(msg: string, data?: unknown): void;
  warn(msg: string, data?: unknown): void;
  error(msg: string, data?: unknown): void;
}

export function createLogger(level: LogLevel, logDir?: string): Logger {
  const file = logDir ? join(logDir, "stint-server.log") : null;
  if (logDir && !existsSync(logDir)) mkdirSync(logDir, { recursive: true });
  const write = (lvl: LogLevel, msg: string, data?: unknown) => {
    if (order[lvl] < order[level]) return;
    const line = `${new Date().toISOString()} ${lvl.toUpperCase().padEnd(5)} ${msg}${data === undefined ? "" : ` ${safeJson(data)}`}`;
    (lvl === "error" || lvl === "warn" ? console.error : console.log)(line);
    if (file) {
      try {
        if (existsSync(file) && statSync(file).size > 5 * 1024 * 1024) renameSync(file, `${file}.1`);
        appendFileSync(file, `${line}\n`);
      } catch {
        // logging must never crash the server
      }
    }
  };
  return {
    debug: (m, d) => write("debug", m, d),
    info: (m, d) => write("info", m, d),
    warn: (m, d) => write("warn", m, d),
    error: (m, d) => write("error", m, d),
  };
}

function safeJson(v: unknown): string {
  if (v instanceof Error) return JSON.stringify({ error: v.message, stack: v.stack });
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
