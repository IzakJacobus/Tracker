import { existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

/** A source of static files: either a folder on disk (dev) or files embedded in the binary. */
export interface StaticSource {
  get(path: string): Blob | null;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
};

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

export function folderSource(dir: string): StaticSource {
  return {
    get(path) {
      const p = normalize(join(dir, path));
      if (!p.startsWith(normalize(dir))) return null;
      return existsSync(p) && statSync(p).isFile() ? Bun.file(p) : null;
    },
  };
}

export function mapSource(files: Record<string, string>): StaticSource {
  return {
    get(path) {
      const f = files[path];
      return f ? Bun.file(f) : null;
    },
  };
}

export const emptySource: StaticSource = { get: () => null };

/** Serves a file, falling back to index.html for client-side routes. */
export function serveStatic(source: StaticSource, pathname: string): Response {
  let path = decodeURIComponent(pathname);
  if (path.endsWith("/")) path += "index.html";
  let file = source.get(path);
  let served = path;
  if (!file && !extname(path)) {
    file = source.get("/index.html");
    served = "/index.html";
  }
  if (!file) {
    return new Response(
      source.get("/index.html")
        ? "Not found"
        : "The Stint web app is not bundled with this build. Run `bun run build`.",
      { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }
  const headers = new Headers({ "content-type": TYPES[extname(served)] ?? "application/octet-stream" });
  if (served.startsWith("/assets/")) headers.set("cache-control", "public, max-age=31536000, immutable");
  else headers.set("cache-control", "no-cache");
  if (served.endsWith(".html")) {
    headers.set("content-security-policy", CSP);
    headers.set("x-frame-options", "DENY");
  }
  headers.set("x-content-type-options", "nosniff");
  return new Response(file, { headers });
}
