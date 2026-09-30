import { Unplug } from "lucide-react";
import { useEffect, useState } from "react";
import { useSession } from "../app/session.tsx";
import { desktop, isDesktop, type PairingStatus } from "../lib/desktop.ts";
import { Button } from "../ui/Button.tsx";
import { ConfirmDialog } from "../ui/Dialog.tsx";
import { Switch } from "../ui/Field.tsx";

export function DesktopSettings() {
  const { logout } = useSession();
  const [auto, setAuto] = useState<boolean | null>(null);
  const [status, setStatus] = useState<PairingStatus | null>(null);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!isDesktop()) return;
    desktop
      .autostartEnabled()
      .then(setAuto)
      .catch(() => setAuto(false));
    desktop
      .pairingStatus()
      .then(setStatus)
      .catch(() => {});
  }, []);
  if (!isDesktop()) return null;
  return (
    <div className="card">
      <div className="card__header">
        <h2>This computer</h2>
      </div>
      <div className="card__body stack">
        {auto !== null && (
          <Switch
            checked={auto}
            onChange={async (v) => {
              await desktop.setAutostart(v);
              setAuto(v);
            }}
            label="Start Stint when I sign in (it waits quietly in the tray)"
          />
        )}
        {status && (
          <div className="row row--between row--wrap">
            <div>
              Connected to <strong>{status.name}</strong>
              <div className="subtle" style={{ fontSize: "var(--text-xs)" }}>
                {status.addresses[0]} · security fingerprint {status.fingerprint.slice(0, 12)}…
              </div>
            </div>
            <Button icon={<Unplug />} onClick={() => setConfirm(true)}>
              Disconnect
            </Button>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={async () => {
          await logout().catch(() => {});
          await desktop.unpair();
          window.location.reload();
        }}
        title="Disconnect from this server?"
        message="You'll be signed out, and Stint will ask you to pick a company again. Time that hasn't synced yet stays on this computer until you reconnect to the same server."
        confirmLabel="Disconnect"
        danger
      />
    </div>
  );
}
