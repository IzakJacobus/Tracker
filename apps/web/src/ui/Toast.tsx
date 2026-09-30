import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";

type Kind = "info" | "success" | "error";
interface ToastItem {
  id: number;
  kind: Kind;
  message: ReactNode;
  action?: { label: string; onClick: () => void };
}

interface ToastApi {
  show(message: ReactNode, opts?: { kind?: Kind; action?: ToastItem["action"]; durationMs?: number }): void;
  success(message: ReactNode): void;
  error(message: ReactNode): void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const api = useMemo<ToastApi>(() => {
    const show: ToastApi["show"] = (message, opts = {}) => {
      const id = ++seq.current;
      setItems((xs) => [...xs.slice(-3), { id, kind: opts.kind ?? "info", message, action: opts.action }]);
      setTimeout(() => dismiss(id), opts.durationMs ?? (opts.kind === "error" ? 8000 : 4500));
    };
    return { show, success: (m) => show(m, { kind: "success" }), error: (m) => show(m, { kind: "error" }) };
  }, [dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" aria-live="polite" aria-atomic="false">
        {items.map((t) => (
          <div key={t.id} className={`toast toast--${t.kind}`} role={t.kind === "error" ? "alert" : "status"}>
            {t.kind === "error" ? <AlertCircle /> : t.kind === "success" ? <CheckCircle2 /> : <Info />}
            <div className="toast__body">{t.message}</div>
            {t.action && (
              <button
                type="button"
                className="toast__action"
                onClick={() => {
                  t.action?.onClick();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
