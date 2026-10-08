import { Component, type ErrorInfo, type ReactNode } from "react";
import { VersionLabel } from "../ui/misc.tsx";
import { APP_VERSION } from "../version.ts";

/** Forget everything Stint saved in this browser (a fresh start; hours not yet sent are lost). */
async function resetThisBrowser(): Promise<void> {
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {
    // storage blocked: nothing to clear
  }
  try {
    const dbs = (await indexedDB.databases?.()) ?? [];
    await Promise.all(
      dbs.map(
        (d) =>
          new Promise<void>((done) => {
            if (!d.name) return done();
            const r = indexedDB.deleteDatabase(d.name);
            r.onsuccess = r.onerror = r.onblocked = () => done();
          }),
      ),
    );
  } catch {
    // older browsers can't list databases
  }
  try {
    for (const k of await caches.keys()) await caches.delete(k);
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  } catch {
    // no service worker here
  }
  window.location.reload();
}

interface State {
  error: Error | null;
}

/**
 * If something in the app breaks while it is drawing, show what happened instead of a blank
 * screen, with ways to recover and text the person can send to their administrator.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Stint crashed while drawing the screen:", error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    const details = [
      `Stint ${APP_VERSION}`,
      `Address: ${window.location.origin}`,
      `Browser: ${navigator.userAgent}`,
      `Error: ${error.name}: ${error.message}`,
      ...(error.stack ? [error.stack.split("\n").slice(0, 6).join("\n")] : []),
    ].join("\n");
    return (
      <div
        role="alert"
        style={{
          minHeight: "100%",
          display: "grid",
          placeItems: "center",
          padding: 24,
          background: "var(--bg, #14110f)",
          color: "var(--text, #f2efe9)",
        }}
      >
        <div style={{ maxWidth: 560, display: "grid", gap: 14 }}>
          <h1 style={{ fontSize: 22 }}>Something went wrong showing this screen</h1>
          <p>
            Your hours are safe: they are saved on this computer and on the server. Try reloading. If it keeps
            happening, send the text below to your Stint administrator.
          </p>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontSize: 12,
              padding: 12,
              borderRadius: 8,
              background: "rgba(255,255,255,0.06)",
              userSelect: "all",
            }}
          >
            {details}
          </pre>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>
              Reload
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                if (
                  window.confirm(
                    "This forgets Stint's saved copy on THIS computer and signs you out. Hours you have not yet sent to the server are lost. Continue?",
                  )
                )
                  void resetThisBrowser();
              }}
            >
              Start fresh on this computer
            </button>
          </div>
          <VersionLabel />
        </div>
      </div>
    );
  }
}
