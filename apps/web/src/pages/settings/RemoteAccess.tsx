import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { useMe } from "../../app/session.tsx";
import { errorMessage } from "../../lib/api.ts";
import { Switch } from "../../ui/Field.tsx";
import { Alert, Badge } from "../../ui/misc.tsx";
import { useToast } from "../../ui/Toast.tsx";
import { type Health, useAdminGet, useSaveSettings } from "./admin.ts";

/**
 * Optional access from outside the office. We recommend Tailscale: nothing is
 * exposed to the internet, there is no domain or router setup, and the free plan
 * covers a small firm. Stint itself never changes Tailscale settings.
 */
export function RemoteAccessPage() {
  const me = useMe();
  const settings = me.organization?.settings;
  const save = useSaveSettings();
  const toast = useToast();
  const { data: h, reload } = useAdminGet<Health>("/admin/health");
  const [busy, setBusy] = useState(false);
  if (!settings) return null;
  const enabled = settings.remoteAccess.enabled;
  const ts = h?.platform?.tailscale;
  const port = h?.server.httpsPort ?? 47600;

  async function toggle(on: boolean) {
    setBusy(true);
    try {
      await save({ remoteAccess: { ...settings!.remoteAccess, enabled: on, provider: "tailscale" } });
      await reload();
      toast.success(on ? "Remote access is on." : "Remote access is off.");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack stack--lg" style={{ maxWidth: 820 }}>
      <Alert tone="info" title="You don't need this in the office">
        Stint works on the office network without any of this. Remote access lets people track time from home
        or site and still sync with the office server.
      </Alert>

      <section className="card card__body stack" aria-labelledby="ts-h">
        <div className="row row--between">
          <h2 id="ts-h">Tailscale (recommended)</h2>
          {ts &&
            (ts.running ? (
              <Badge tone="primary">Connected</Badge>
            ) : ts.installed ? (
              <Badge tone="warning">Installed, not connected</Badge>
            ) : (
              <Badge>Not installed</Badge>
            ))}
        </div>
        <p>
          Tailscale makes a private network between your PCs and laptops over the internet. Nothing is opened
          to the public, there's no router to configure, and the server's address stays the same wherever
          people are.
        </p>
        <ol className="howto-steps">
          <li>
            Install Tailscale on <strong>this server PC</strong> and sign in with the firm's account (
            <a href="https://tailscale.com/download" target="_blank" rel="noreferrer">
              tailscale.com/download <ExternalLink size={12} aria-hidden="true" />
            </a>
            ).
          </li>
          <li>
            Install Tailscale on each laptop that should work away from the office, signed in to the same
            account.
          </li>
          <li>Turn on remote access below.</li>
          <li>
            On a laptop, open the Stint app's Settings → Server and pair with the address below, or open it in
            a browser.
          </li>
        </ol>
        <Switch
          checked={enabled}
          disabled={busy}
          onChange={(v) => void toggle(v)}
          label="Allow Stint to be reached over Tailscale"
        />
        {enabled && ts?.running && (
          <Alert tone="success" title="Remote address">
            <span className="mono">
              https://{ts.dnsName ?? ts.ips[0]}:{port}
            </span>
            {ts.ips.length > 0 && <div className="muted">Tailscale IP: {ts.ips.join(", ")}</div>}
            <div className="muted">
              Restart Stint Server once after turning this on, so its certificate includes this name.
            </div>
          </Alert>
        )}
        {enabled && ts && !ts.running && (
          <Alert tone="warning">
            {ts.installed
              ? "Tailscale is installed on this PC but not connected. Open Tailscale and sign in."
              : "Tailscale isn't installed on this PC yet (step 1)."}
          </Alert>
        )}
      </section>

      <section className="card card__body stack" aria-labelledby="cmp-h">
        <h2 id="cmp-h">Why Tailscale and not Cloudflare Tunnel?</h2>
        <table className="table">
          <thead>
            <tr>
              <th />
              <th>Tailscale</th>
              <th>Cloudflare Tunnel</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Free plan</th>
              <td>Personal plan: up to 6 users, unlimited devices</td>
              <td>Zero Trust free plan: up to 50 users (card required)</td>
            </tr>
            <tr>
              <th scope="row">You need</th>
              <td>The Tailscale app on the server and each laptop</td>
              <td>Your own domain on Cloudflare, plus Access rules</td>
            </tr>
            <tr>
              <th scope="row">Exposed to the internet</th>
              <td>No — only your devices can connect</td>
              <td>A public hostname, protected by Cloudflare Access</td>
            </tr>
            <tr>
              <th scope="row">Desktop app pairing</th>
              <td>Works unchanged (same certificate pinning)</td>
              <td>Needs Cloudflare's certificate; browser only</td>
            </tr>
          </tbody>
        </table>
        <p className="muted">
          Plans change — check the current limits on the vendors' pricing pages before you rely on them. More
          than 6 people working remotely? See docs/REMOTE_ACCESS.md for the paid plan and the Cloudflare
          option.
        </p>
      </section>
    </div>
  );
}
