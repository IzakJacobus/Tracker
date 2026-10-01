import { Building2, KeyRound, Loader2, RefreshCw, Wifi } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { desktop, type FoundServer, type PairingStatus } from "../../lib/desktop.ts";
import { Button } from "../../ui/Button.tsx";
import { Field, Input } from "../../ui/Field.tsx";
import { Alert, Logo } from "../../ui/misc.tsx";
import { AuthLayout } from "./AuthLayout.tsx";

/**
 * First run of the desktop app: find the company's Stint Server on the office
 * network (no IP addresses), or type the pairing code shown on the server.
 */
export function PairScreen({ onPaired }: { onPaired: (s: PairingStatus) => void }) {
  const [found, setFound] = useState<FoundServer[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async () => {
    setSearching(true);
    setError(null);
    try {
      setFound(await desktop.discover(2500));
    } catch (e) {
      setError(String(e));
      setFound([]);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    void search();
  }, [search]);

  async function pick(f: FoundServer) {
    setBusyId(f.id);
    setError(null);
    try {
      onPaired(await desktop.pairDiscovered(f));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyId(null);
    }
  }

  async function submitCode(e: FormEvent) {
    e.preventDefault();
    setBusyId("code");
    setError(null);
    try {
      onPaired(await desktop.pairWithCode(code));
    } catch (err) {
      setError(String(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AuthLayout>
      <Logo size={30} />
      <div className="stack stack--sm">
        <h1>Connect to your company</h1>
        <p className="muted">
          Stint looks for your office's Stint Server on this network. Pick your company to continue.
        </p>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="stack stack--sm" aria-live="polite">
        {found === null || (searching && found.length === 0) ? (
          <div className="pair-list__empty">
            <Loader2 className="spin" /> Looking for Stint Servers…
          </div>
        ) : found.length === 0 ? (
          <Alert tone="warning" title="No Stint Server found">
            Make sure this computer is on the office network (the same WiFi or cable as the server PC), and
            that the server PC is switched on. If it still isn't found, use the pairing code shown on the
            server.
          </Alert>
        ) : (
          <ul className="pair-list">
            {found.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  className="pair-list__item"
                  onClick={() => void pick(f)}
                  disabled={busyId !== null}
                >
                  <span className="pair-list__icon">
                    <Building2 />
                  </span>
                  <span className="grow">
                    <strong>{f.name || "Stint Server"}</strong>
                    <span className="subtle pair-list__sub">Stint {f.version}</span>
                  </span>
                  {busyId === f.id ? <Loader2 className="spin" /> : <Wifi />}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="row">
          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw />}
            onClick={() => void search()}
            loading={searching}
          >
            Search again
          </Button>
          <Button variant="ghost" size="sm" icon={<KeyRound />} onClick={() => setShowCode((s) => !s)}>
            I have a pairing code
          </Button>
        </div>
      </div>
      {showCode && (
        <form className="stack" onSubmit={submitCode}>
          <Field
            label="Pairing code"
            hint="Shown on the server PC under Settings → Health. Letters and numbers, dashes optional."
          >
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
              className="mono"
              autoFocus
              autoCapitalize="characters"
              spellCheck={false}
            />
          </Field>
          <Button
            type="submit"
            variant="primary"
            loading={busyId === "code"}
            disabled={code.replace(/[\s-]/g, "").length < 16}
          >
            Connect
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
