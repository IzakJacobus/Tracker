/**
 * Network transport. The browser/PWA talks to the same origin with a cookie
 * session. The desktop app (Tauri) routes requests through Rust, which pins the
 * server's certificate and holds the session token; see DesktopTransport.
 */
export interface TransportResponse {
  status: number;
  body: unknown;
}

export interface Transport {
  kind: "browser" | "desktop";
  request(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<TransportResponse>;
}

export class NetworkError extends Error {
  constructor(message = "Cannot reach the Stint server.") {
    super(message);
    this.name = "NetworkError";
  }
}

export class BrowserTransport implements Transport {
  readonly kind = "browser" as const;
  constructor(private readonly base = "/api") {}

  async request(
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<TransportResponse> {
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, {
        method,
        credentials: "same-origin",
        headers: {
          "x-stint-request": "1",
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      throw new NetworkError();
    }
    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { error: { code: "bad_response", message: text.slice(0, 200) } };
      }
    }
    // A proxy/gateway error means the Stint server itself is unreachable.
    if (res.status === 502 || res.status === 503 || res.status === 504) throw new NetworkError();
    return { status: res.status, body: parsed };
  }
}

interface TauriInternals {
  invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
}

export function tauri(): TauriInternals | null {
  const w = window as unknown as { __TAURI_INTERNALS__?: TauriInternals };
  return w.__TAURI_INTERNALS__ ?? null;
}

export class DesktopTransport implements Transport {
  readonly kind = "desktop" as const;
  async request(method: string, path: string, body?: unknown): Promise<TransportResponse> {
    const t = tauri();
    if (!t) throw new NetworkError("Desktop bridge unavailable.");
    try {
      return await t.invoke<TransportResponse>("api_request", { method, path, body: body ?? null });
    } catch (e) {
      throw new NetworkError(typeof e === "string" ? e : "Cannot reach the Stint server.");
    }
  }
}

export function defaultTransport(): Transport {
  return tauri() ? new DesktopTransport() : new BrowserTransport();
}
