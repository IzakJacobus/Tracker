import { ArrowUp, DatabaseBackup, Folder, HardDrive, History, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useMe } from "../../app/session.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import { Button } from "../../ui/Button.tsx";
import { ConfirmDialog, Dialog } from "../../ui/Dialog.tsx";
import { Field, Input } from "../../ui/Field.tsx";
import { Alert, EmptyState } from "../../ui/misc.tsx";
import { useToast } from "../../ui/Toast.tsx";
import {
  type BackupEntry,
  fmtBytes,
  fmtWhen,
  type LastBackup,
  useAdminGet,
  useSaveSettings,
} from "./admin.ts";

interface BackupsInfo {
  folder: string;
  last: LastBackup | null;
  files: BackupEntry[];
  safetyCopies: BackupEntry[];
}

interface Listing {
  path: string | null;
  parent: string | null;
  folders: { name: string; path: string }[];
  suggestions: { label: string; path: string }[];
}

/** "stint-2026-09-30-0200-manual.db" → "2026-09-30 02:00 (manual)" */
function describe(name: string): string {
  const m = /^stint-(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})(?:-([a-z-]+))?\.db$/.exec(name);
  if (!m) return name;
  const kind = m[4] ? ` · ${m[4].replace("-", " ")}` : "";
  return `${m[1]} ${m[2]}:${m[3]}${kind}`;
}

function FolderPicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (path: string) => Promise<void>;
}) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const browse = useCallback(async (p: string | null) => {
    try {
      const l = await api.get<Listing>(`/admin/fs${p ? `?path=${encodeURIComponent(p)}` : ""}`);
      setListing(l);
      if (l.path) setPath(l.path);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    if (open) void browse(null);
  }, [open, browse]);

  async function choose() {
    setBusy(true);
    setError(null);
    try {
      await onPick(path);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Choose a backup folder"
      wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!path.trim()} onClick={() => void choose()}>
            Use this folder
          </Button>
        </>
      }
    >
      <div className="stack">
        <p className="muted">
          Folders on the server PC. A USB drive or a OneDrive folder protects you if this PC's disk fails.
          Stint makes a test backup there before switching.
        </p>
        {error && <Alert tone="danger">{error}</Alert>}
        {listing && listing.suggestions.length > 0 && (
          <div className="stack stack--sm">
            <div className="field__label">Suggestions</div>
            <div className="row row--wrap">
              {listing.suggestions.map((s) => (
                <Button key={s.path} size="sm" icon={<HardDrive />} onClick={() => setPath(s.path)}>
                  {s.label}
                </Button>
              ))}
            </div>
          </div>
        )}
        <Field label="Folder">
          <Input value={path} onChange={(e) => setPath(e.target.value)} className="mono" />
        </Field>
        {listing && (
          <div className="folder-browser">
            {listing.parent !== null || listing.path ? (
              <button
                type="button"
                className="folder-browser__item"
                onClick={() => void browse(listing.parent)}
              >
                <ArrowUp aria-hidden="true" /> Up
              </button>
            ) : null}
            {listing.folders.map((f) => (
              <button
                key={f.path}
                type="button"
                className="folder-browser__item"
                onClick={() => void browse(f.path)}
              >
                <Folder aria-hidden="true" /> {f.name}
              </button>
            ))}
            {listing.folders.length === 0 && <p className="muted">No folders here.</p>}
          </div>
        )}
      </div>
    </Dialog>
  );
}

export function BackupsPage() {
  const me = useMe();
  const settings = me.organization?.settings;
  const tz = settings?.timezone ?? "Africa/Johannesburg";
  const { data, error, reload } = useAdminGet<BackupsInfo>("/admin/backups");
  const save = useSaveSettings();
  const toast = useToast();
  const [picking, setPicking] = useState(false);
  const [time, setTime] = useState(settings?.backup.time ?? "02:00");
  const [keep, setKeep] = useState(String(settings?.backup.keep ?? 30));
  const [busy, setBusy] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<BackupEntry | null>(null);

  async function act(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function pickFolder(folder: string) {
    // Throws (and the dialog shows why) if the folder can't be written.
    await api.post("/admin/backups/run", { folder });
    await save({ backup: { ...settings!.backup, folder } });
    toast.success("Backups now go to the new folder. A first backup is already there.");
    await reload();
  }

  if (!data || !settings) return error ? <Alert tone="danger">{error}</Alert> : null;
  const isDefault = !settings.backup.folder;

  return (
    <div className="stack stack--lg" style={{ maxWidth: 900 }}>
      {data.last && !data.last.ok && (
        <Alert tone="danger" title="The last backup failed">
          {data.last.error}
        </Alert>
      )}

      <section className="card card__body stack" aria-labelledby="where-h">
        <h2 id="where-h">Where backups go</h2>
        <div className="row row--between row--wrap">
          <div className="stack stack--sm">
            <span className="mono">{data.folder}</span>
            {isDefault && (
              <span className="muted">
                On this PC only. Choose a USB drive or OneDrive folder so a disk failure can't take the
                backups too.
              </span>
            )}
          </div>
          <Button icon={<Folder />} onClick={() => setPicking(true)}>
            Change folder
          </Button>
        </div>
        <div className="form-grid">
          <Field
            label="Back up every night at"
            hint="If the PC is off then, Stint backs up when it next starts."
          >
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
          <Field label="Number of backups to keep" hint="Older backups are deleted automatically.">
            <Input type="number" min={1} max={365} value={keep} onChange={(e) => setKeep(e.target.value)} />
          </Field>
        </div>
        <div className="row">
          <Button
            variant="primary"
            loading={busy === "save"}
            disabled={time === settings.backup.time && Number(keep) === settings.backup.keep}
            onClick={() =>
              void act("save", async () => {
                await save({
                  backup: { ...settings.backup, time, keep: Math.max(1, Math.min(365, Number(keep) || 30)) },
                });
                toast.success("Backup schedule saved.");
              })
            }
          >
            Save schedule
          </Button>
          <Button
            icon={<DatabaseBackup />}
            loading={busy === "run"}
            onClick={() =>
              void act("run", async () => {
                await api.post("/admin/backups/run");
                toast.success("Backup finished.");
                await reload();
              })
            }
          >
            Back up now
          </Button>
        </div>
      </section>

      <section className="card" aria-labelledby="list-h">
        <div className="card__header">
          <h2 id="list-h">Backups ({data.files.length})</h2>
        </div>
        {data.files.length === 0 ? (
          <EmptyState icon={<History />} title="No backups yet">
            The first one runs tonight at {settings.backup.time}, or click “Back up now”.
          </EmptyState>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Made</th>
                <th className="num">Size</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.files.map((f) => (
                <tr key={f.name}>
                  <td>{describe(f.name)}</td>
                  <td className="num">{fmtBytes(f.sizeBytes)}</td>
                  <td style={{ textAlign: "right" }}>
                    <Button size="sm" variant="ghost" icon={<RotateCcw />} onClick={() => setRestoring(f)}>
                      Restore
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {data.safetyCopies.length > 0 && (
        <details className="card card__body">
          <summary>Safety copies made before restores ({data.safetyCopies.length})</summary>
          <ul className="plain-list" style={{ marginTop: "var(--space-3)" }}>
            {data.safetyCopies.map((f) => (
              <li key={f.name} className="row row--between">
                <span>
                  {describe(f.name)} · {fmtBytes(f.sizeBytes)}
                </span>
                <Button size="sm" variant="ghost" icon={<RotateCcw />} onClick={() => setRestoring(f)}>
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}

      <FolderPicker open={picking} onClose={() => setPicking(false)} onPick={pickFolder} />
      <ConfirmDialog
        open={restoring !== null}
        onClose={() => setRestoring(null)}
        title="Restore this backup?"
        danger
        busy={busy === "restore"}
        confirmLabel="Restore"
        message={
          <>
            Stint goes back to how it was at <strong>{restoring ? describe(restoring.name) : ""}</strong>.
            Anything recorded after that is lost, and everyone's app reloads its data. People who signed in
            after that backup was made (you too, perhaps) will have to sign in again. A safety copy of the
            current data is made first, so you can undo this.
          </>
        }
        onConfirm={() =>
          void act("restore", async () => {
            if (!restoring) return;
            const r = await api.post<{ restartRequired?: boolean }>("/admin/backups/restore", {
              name: restoring.name,
            });
            setRestoring(null);
            toast.success(
              r.restartRequired
                ? "Restored. Stint Server is restarting to load the restored certificate."
                : "Restored. Reloading…",
            );
            setTimeout(() => window.location.reload(), 1500);
          })
        }
      />
      <p className="muted">
        Times are shown in {tz}. Last successful backup: {fmtWhen(data.last?.ok ? data.last.at : null, tz)}.
      </p>
    </div>
  );
}
