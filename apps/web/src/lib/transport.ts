/** Network transport: the browser/PWA talks to the same origin with a cookie session. */
export interface TransportResponse {
  status: number;
  body: unknown;
}

export interface Transport {
  kind: "browser";
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

export function defaultTransport(): Transport {
  return new BrowserTransport();
}
