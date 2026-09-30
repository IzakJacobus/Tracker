import type { Plugin } from "vite";

/**
 * Emits /sw.js with the list of every built file, so the whole app shell is
 * cached on install and Stint opens with no network at all.
 */
export function serviceWorker(): Plugin {
  return {
    name: "stint-service-worker",
    apply: "build",
    generateBundle(_opts, bundle) {
      const files = Object.keys(bundle)
        .filter((f) => !f.endsWith(".map") && f !== "sw.js")
        .map((f) => `/${f}`);
      const version = Date.now().toString(36);
      const source = `/* Stint service worker — generated at build time */
const VERSION = ${JSON.stringify(version)};
const CACHE = "stint-shell-" + VERSION;
const PRECACHE = ${JSON.stringify(["/", ...files])};

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("stint-shell-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname === "/stint-ca.crt") return; // never cache data
  if (req.mode === "navigate") {
    // Network first so updates arrive, cached app shell when offline.
    event.respondWith(
      fetch(req).catch(() => caches.match("/", { cacheName: CACHE }).then((r) => r || caches.match("/index.html"))),
    );
    return;
  }
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && url.pathname.startsWith("/assets/")) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
`;
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}
