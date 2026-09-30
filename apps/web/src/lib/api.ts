import { defaultTransport, NetworkError, type Transport } from "./transport.ts";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> = {},
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export { NetworkError };

let transport: Transport = defaultTransport();
const unauthorizedListeners = new Set<() => void>();

export function setTransport(t: Transport): void {
  transport = t;
}
export function getTransport(): Transport {
  return transport;
}

export function onUnauthorized(fn: () => void): () => void {
  unauthorizedListeners.add(fn);
  return () => unauthorizedListeners.delete(fn);
}

async function call<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await transport.request(method, path, body, signal);
  if (res.status >= 200 && res.status < 300) return res.body as T;
  const err = (
    res.body as {
      error?: { code?: string; message?: string; details?: { fields?: Record<string, string> } };
    } | null
  )?.error;
  if (res.status === 401 && !path.startsWith("/auth/login")) {
    for (const f of unauthorizedListeners) f();
  }
  throw new ApiError(
    res.status,
    err?.code ?? "error",
    err?.message ?? `Request failed (${res.status})`,
    err?.details?.fields ?? {},
    err?.details,
  );
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => call<T>("GET", path, undefined, signal),
  post: <T>(path: string, body?: unknown) => call<T>("POST", path, body ?? {}),
  put: <T>(path: string, body?: unknown) => call<T>("PUT", path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => call<T>("PATCH", path, body ?? {}),
  del: <T>(path: string, body?: unknown) => call<T>("DELETE", path, body),
};

/** A human sentence for any error thrown by the API layer. */
export function errorMessage(e: unknown): string {
  if (e instanceof NetworkError)
    return "You're offline or the Stint server can't be reached. Your work is saved on this computer.";
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return "Something went wrong.";
}
