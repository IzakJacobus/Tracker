import { AlertCircle, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { APP_VERSION } from "../version.ts";

export function Badge({
  tone,
  children,
  title,
}: {
  tone?: "primary" | "live" | "danger" | "warning" | "info";
  children: ReactNode;
  title?: string;
}) {
  return (
    <span className={`badge${tone ? ` badge--${tone}` : ""}`} title={title}>
      {children}
    </span>
  );
}

export function Alert({
  tone = "info",
  title,
  children,
  action,
}: {
  tone?: "info" | "warning" | "danger" | "success";
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const Icon =
    tone === "danger"
      ? AlertCircle
      : tone === "warning"
        ? AlertTriangle
        : tone === "success"
          ? CheckCircle2
          : Info;
  return (
    <div className={`alert alert--${tone}`} role={tone === "danger" ? "alert" : "status"}>
      <Icon aria-hidden="true" />
      <div className="grow stack stack--sm" style={{ gap: 2 }}>
        {title && <div className="alert__title">{title}</div>}
        {children && <div>{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty__icon" aria-hidden="true">
        {icon}
      </div>
      <div className="empty__title">{title}</div>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (
    ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase() ||
    "?"
  );
}

export function Avatar({ name, color, size }: { name: string; color: string; size?: "lg" }) {
  return (
    <span
      className={`avatar${size ? ` avatar--${size}` : ""}`}
      style={{ background: color } as CSSProperties}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

export function Progress({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(100, value * 100));
  const tone = value >= 1 ? "danger" : value >= 0.8 ? "warning" : "";
  return (
    <div
      className={`progress${tone ? ` progress--${tone}` : ""}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
    >
      <div className="progress__bar" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Dot({ color }: { color: string }) {
  return <span className="dot" style={{ background: color }} aria-hidden="true" />;
}

/** Stint logo: a clock ring with an ochre "stint" segment. */
/** "Stint 0.3.0", so people can say which version they are on. */
export function VersionLabel({ className }: { className?: string }) {
  return (
    <span className={`version-label${className ? ` ${className}` : ""}`} data-testid="app-version">
      Stint {APP_VERSION}
    </span>
  );
}

export function Logo({ size = 28, withWordmark = true }: { size?: number; withWordmark?: boolean }) {
  return (
    <span className="logo" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="var(--fynbos-700)" />
        <circle
          cx="16"
          cy="16"
          r="9"
          fill="none"
          stroke="var(--fynbos-300)"
          strokeWidth="3.2"
          opacity="0.55"
        />
        <path
          d="M16 7 A9 9 0 0 1 24.4 19.2"
          fill="none"
          stroke="var(--ochre-400)"
          strokeWidth="3.2"
          strokeLinecap="round"
        />
        <circle cx="16" cy="16" r="2.2" fill="#fff" />
      </svg>
      {withWordmark && (
        <span
          style={{ fontWeight: 600, fontSize: size * 0.68, letterSpacing: "-0.02em", color: "var(--text)" }}
        >
          stint
        </span>
      )}
    </span>
  );
}
