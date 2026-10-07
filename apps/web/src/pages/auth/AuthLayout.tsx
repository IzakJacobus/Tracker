import { CheckCircle2 } from "lucide-react";
import type { ReactNode } from "react";
import { Logo, VersionLabel } from "../../ui/misc.tsx";

export function AuthLayout({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="auth">
      <aside className="auth__aside" aria-hidden="true">
        <Logo size={32} />
        <div>
          <h1>Every hour, accounted for.</h1>
          <p style={{ marginTop: 12 }}>
            Stint runs on your own office computer. Your time stays on your network — and keeps working when
            the network doesn't.
          </p>
          <ul className="auth__points">
            <li>
              <CheckCircle2 /> Logging hours is instant, even offline
            </li>
            <li>
              <CheckCircle2 /> Monthly timesheets and client summaries in one click
            </li>
            <li>
              <CheckCircle2 /> No cloud, no subscriptions, no IT department
            </li>
          </ul>
        </div>
        <small style={{ color: "var(--fynbos-300)" }}>
          Free and open source · MIT licence · <VersionLabel />
        </small>
      </aside>
      <main className="auth__main" id="main">
        <div className={`auth__panel${wide ? " auth__panel--wide" : ""}`}>{children}</div>
      </main>
    </div>
  );
}
