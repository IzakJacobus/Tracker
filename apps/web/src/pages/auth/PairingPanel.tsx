import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import { Alert } from "../../ui/misc.tsx";

interface Pairing {
  code: string | null;
  qrSvg: string | null;
  addresses: string[];
  port: number | null;
  networkWarning: string | null;
}

/** Shows the pairing code (and QR) other computers can use if discovery doesn't find the server. */
export function PairingPanel() {
  const [p, setP] = useState<Pairing | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api
      .get<Pairing>("/pairing")
      .then(setP)
      .catch(() => setFailed(true));
  }, []);
  if (failed)
    return (
      <Alert tone="warning">The pairing code isn't available right now. Open Settings → Health later.</Alert>
    );
  if (!p) return <div className="pair-code subtle">…</div>;
  return (
    <div className="stack">
      {p.networkWarning && (
        <Alert tone="warning" title="Other computers may not be able to connect">
          {p.networkWarning}
        </Alert>
      )}
      <div className="row row--wrap" style={{ alignItems: "center", gap: 24 }}>
        {p.qrSvg && (
          <img
            src={`data:image/svg+xml;base64,${btoa(p.qrSvg)}`}
            alt="QR code for connecting a phone or tablet"
            width={132}
            height={132}
            style={{ background: "#fff", padding: 6, borderRadius: 8 }}
          />
        )}
        <div className="grow stack stack--sm">
          <span className="sr-only">Pairing code:</span>
          <output className="pair-code">{p.code ?? "—"}</output>
          <span className="subtle" style={{ fontSize: "var(--text-sm)" }}>
            This code is also on the Health page in Settings, so you can find it again any time.
          </span>
        </div>
      </div>
    </div>
  );
}
