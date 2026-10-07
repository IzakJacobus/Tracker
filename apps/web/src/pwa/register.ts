type UpdateListener = (apply: () => void) => void;
const listeners = new Set<UpdateListener>();

/** Called when a new version of the web app has been downloaded and is waiting. */
export function onAppUpdate(fn: UpdateListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Registers the service worker, for offline use and installing as an app. Needs a secure context: HTTPS on the LAN, or localhost. */
export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator) || !window.isSecureContext || import.meta.env.DEV) return;
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      const announce = (worker: ServiceWorker) => {
        const apply = () => {
          worker.postMessage("skip-waiting");
          navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), {
            once: true,
          });
        };
        for (const l of listeners) l(apply);
      };
      if (reg.waiting && navigator.serviceWorker.controller) announce(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const w = reg.installing;
        w?.addEventListener("statechange", () => {
          if (w.state === "installed" && navigator.serviceWorker.controller) announce(w);
        });
      });
      // Check for a new version every hour while open.
      setInterval(() => void reg.update(), 3600_000);
      // ...and whenever the app is brought back to the front, so the first look of the day is current.
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") void reg.update();
      });
    } catch {
      // Not fatal: Stint still works online without the service worker.
    }
  });
}
