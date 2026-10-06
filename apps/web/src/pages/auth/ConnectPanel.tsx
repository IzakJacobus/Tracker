import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import { Alert } from "../../ui/misc.tsx";

interface Connect {
  url: string | null;
  urls: string[];
  qrUrl: string | null;
  qrSvg: string | null;
  networkWarning: string | null;
}

/** The address other computers, phones and tablets open in a browser to use Stint. */
export function ConnectPanel({ onHealthPage = false }: { onHealthPage?: boolean }) {
  const [c, setC] = useState<Connect | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api
      .get<Connect>("/connect")
      .then(setC)
      .catch(() => setFailed(true));
  }, []);
  if (failed)
    return <Alert tone="warning">The address isn't available right now. Open Settings → Health later.</Alert>;
  if (!c) return <div className="subtle">…</div>;
  const others = c.urls.filter((u) => u !== c.url);
  return (
    <div className="stack">
      {c.networkWarning && (
        <Alert tone="warning" title="Other computers may not be able to connect">
          {c.networkWarning}
        </Alert>
      )}
      {!c.url && (
        <Alert tone="warning">This PC has no network address yet. Connect it to the office network.</Alert>
      )}
      {c.url && (
        <div className="row row--wrap" style={{ alignItems: "center", gap: 24 }}>
          {c.qrSvg && (
            <img
              src={`data:image/svg+xml;base64,${btoa(c.qrSvg)}`}
              alt={`QR code for ${c.qrUrl ?? c.url}, for phones and tablets`}
              width={132}
              height={132}
              style={{ background: "#fff", padding: 6, borderRadius: 8 }}
            />
          )}
          <div className="grow stack stack--sm">
            <span className="field__label">Open this address in Chrome, Edge, Firefox or Safari</span>
            <output className="pair-code">{c.url}</output>
            {others.length > 0 && (
              <span className="subtle" style={{ fontSize: "var(--text-sm)" }}>
                If that doesn't open, try{" "}
                {others.map((u, i) => (
                  <span key={u}>
                    {i > 0 && " or "}
                    <span className="mono">{u}</span>
                  </span>
                ))}
                .
              </span>
            )}
          </div>
        </div>
      )}
      <ul className="subtle" style={{ fontSize: "var(--text-sm)", margin: 0, paddingLeft: 18 }}>
        <li>
          The first time, the browser warns that the connection isn't private, because Stint makes its own
          certificate. To stop the warning, install{" "}
          <a href="/stint-ca.crt" download>
            Stint's certificate
          </a>{" "}
          as a trusted root on each computer.
        </li>
        <li>
          To use Stint like an app, choose <strong>Install Stint</strong> (or{" "}
          <strong>Add to Home Screen</strong>) from the browser menu.
        </li>
        {!onHealthPage && (
          <li>This address is also on the Health page in Settings, so you can find it again any time.</li>
        )}
      </ul>
    </div>
  );
}
