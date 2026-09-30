import type { Server } from "bun";

/** Tries `preferred`, then the next ports, until one is free. */
export function listenWithFallback<T>(
  preferred: number,
  start: (port: number) => Server<T>,
  attempts = 20,
): Server<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    const port = preferred + i * 2;
    if (port > 65535) break;
    try {
      return start(port);
    } catch (e) {
      lastError = e;
      const code = (e as { code?: string }).code;
      if (code !== "EADDRINUSE" && code !== "EACCES" && !/in use|EADDRINUSE/i.test(String(e))) throw e;
    }
  }
  throw new Error(`No free port found near ${preferred}: ${String(lastError)}`);
}
