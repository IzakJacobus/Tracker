/** Network transport: the browser/PWA talks to the same origin with a cookie session. */
export interface TransportResponse {
  status: number;
  body: unknown;
}

export interface Transport {
  kind: "browser";
  request(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<TransportResponse>;
}

const REQUEST_TIMEOUT_MS = 30_000;

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
    // A request that gets no answer (a connection that died while the computer slept) must end, or
    // syncing would wait for it forever.
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS);
    const abort = () => timeout.abort();
    signal?.addEventListener("abort", abort);
    try {
      res = await fetch(`${this.base}${path}`, {
        method,
        credentials: "same-origin",
        headers: {
          "x-stint-request": "1",
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: timeout.signal,
      });
    } catch (e) {
      // Cancelled by the caller: pass that on. Timed out or unreachable: the server can't be reached.
      if (signal?.aborted) throw e;
      throw new NetworkError();
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
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

export function defaultTransport(): Transport {
  return new BrowserTransport();
}
