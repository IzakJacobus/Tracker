import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ApiError, api, NetworkError, onUnauthorized } from "../lib/api.ts";
import type { Me } from "../lib/types.ts";

type SessionState =
  | { status: "loading" }
  | { status: "needs-setup"; fromServerPc: boolean }
  | { status: "anonymous" }
  | { status: "offline" }
  | { status: "authed"; me: Me };

interface SessionApi {
  state: SessionState;
  me: Me | null;
  refresh(): Promise<void>;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
}

const SessionContext = createContext<SessionApi | null>(null);
const CACHE_KEY = "stint.me";

function cachedMe(): Me | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Me) : null;
  } catch {
    return null;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: "loading" });

  const refresh = useCallback(async () => {
    try {
      const me = await api.get<Me>("/auth/me");
      localStorage.setItem(CACHE_KEY, JSON.stringify(me));
      setState({ status: "authed", me });
    } catch (e) {
      if (e instanceof NetworkError) {
        // Local-first: if we were signed in before, keep working offline.
        const me = cachedMe();
        setState(me ? { status: "authed", me } : { status: "offline" });
        return;
      }
      if (e instanceof ApiError && e.status === 401) {
        localStorage.removeItem(CACHE_KEY);
        try {
          const s = await api.get<{ setupComplete: boolean; fromServerPc: boolean }>("/setup/status");
          setState(
            s.setupComplete
              ? { status: "anonymous" }
              : { status: "needs-setup", fromServerPc: s.fromServerPc },
          );
        } catch {
          setState({ status: "anonymous" });
        }
        return;
      }
      setState({ status: "anonymous" });
    }
  }, []);

  useEffect(() => {
    void refresh();
    return onUnauthorized(() => {
      localStorage.removeItem(CACHE_KEY);
      setState({ status: "anonymous" });
    });
  }, [refresh]);

  // Opened while the server was down (and nobody was signed in before): keep looking for it,
  // every few seconds and whenever the window comes back, instead of waiting for a reload.
  const offline = state.status === "offline";
  useEffect(() => {
    if (!offline) return;
    const retry = () => void refresh();
    const timer = setInterval(retry, 5_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") retry();
    };
    window.addEventListener("online", retry);
    window.addEventListener("focus", retry);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", retry);
      window.removeEventListener("focus", retry);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [offline, refresh]);

  const value = useMemo<SessionApi>(
    () => ({
      state,
      me: state.status === "authed" ? state.me : null,
      refresh,
      async login(email, password) {
        await api.post("/auth/login", { email, password });
        await refresh();
      },
      async logout() {
        try {
          await api.post("/auth/logout");
        } finally {
          localStorage.removeItem(CACHE_KEY);
          setState({ status: "anonymous" });
        }
      },
    }),
    [state, refresh],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionApi {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>");
  return ctx;
}

/** The signed-in user. Only use inside authenticated routes. */
export function useMe(): Me {
  const { me } = useSession();
  if (!me) throw new Error("useMe used outside an authenticated route");
  return me;
}
