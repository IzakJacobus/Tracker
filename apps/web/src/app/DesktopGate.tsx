import { type ReactNode, useEffect, useState } from "react";
import { desktop, isDesktop, type PairingStatus } from "../lib/desktop.ts";
import { PairScreen } from "../pages/auth/PairScreen.tsx";
import { Logo } from "../ui/misc.tsx";

/** In the desktop app, pair with a server before anything else. */
export function DesktopGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"checking" | "unpaired" | "paired">(isDesktop() ? "checking" : "paired");
  useEffect(() => {
    if (!isDesktop()) return;
    desktop
      .pairingStatus()
      .then((s: PairingStatus | null) => setState(s ? "paired" : "unpaired"))
      .catch(() => setState("unpaired"));
  }, []);
  if (state === "checking")
    return (
      <div style={{ height: "100%", display: "grid", placeItems: "center" }}>
        <Logo size={36} />
      </div>
    );
  if (state === "unpaired") return <PairScreen onPaired={() => setState("paired")} />;
  return <>{children}</>;
}
