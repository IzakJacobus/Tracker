import { FileUp, Upload } from "lucide-react";
import { type ChangeEvent, useState } from "react";
import { useData } from "../../data/DataProvider.tsx";
import { useUsers } from "../../data/hooks.ts";
import { api, errorMessage } from "../../lib/api.ts";
import { fmtHours } from "../../lib/format.ts";
import { Button } from "../../ui/Button.tsx";
import { Field, Select, Switch } from "../../ui/Field.tsx";
import { Alert } from "../../ui/misc.tsx";
import { useToast } from "../../ui/Toast.tsx";

interface Summary {
  dryRun: boolean;
  format: "toggl" | "stint" | "generic";
  rows: number;
  imported: number;
  duplicates: number;
  locked: number;
  seconds: number;
  errors: { line: number; message: string }[];
  unmatchedPeople: string[];
  created: { clients: string[]; projects: string[]; tasks: string[]; tags: string[] };
}

const FORMAT = {
  toggl: "Toggl Track detailed report",
  stint: "Stint export",
  generic: "CSV with Date, Person, Project and Duration columns",
};

function CreatedList({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <strong>
        New {label} ({items.length}):
      </strong>{" "}
      <span className="muted">
        {items.slice(0, 12).join(", ")}
        {items.length > 12 ? ` and ${items.length - 12} more` : ""}
      </span>
    </div>
  );
}

/** Bring in history from Toggl Track (or a previous Stint) as CSV. Always previews first. */
export function ImportPage() {
  const users = useUsers();
  const { mutate } = useData();
  const toast = useToast();
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [createMissing, setCreateMissing] = useState(true);
  const [people, setPeople] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 20_000_000) {
      setError("The file is too big (20 MB at most). Export a shorter date range.");
      return;
    }
    setFile({ name: f.name, text: await f.text() });
    setResult(null);
    setPeople({});
    setError(null);
  }

  async function run(dryRun: boolean, mapping = people) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const chosen = Object.fromEntries(Object.entries(mapping).filter(([, id]) => id));
      const body = { csv: file.text, dryRun, createMissing, people: chosen };
      const r = dryRun
        ? await api.post<Summary>("/admin/import", body)
        : await mutate(() => api.post<Summary>("/admin/import", body));
      setResult(r);
      if (!dryRun) toast.success(`Imported ${r.imported} entries (${fmtHours(r.seconds)} h).`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const unmatched = result?.unmatchedPeople ?? [];

  return (
    <div className="stack stack--lg" style={{ maxWidth: 900 }}>
      <Alert tone="info" title="Moving from Toggl Track?">
        In Toggl, open Reports → Detailed, choose the date range and export as CSV. Upload that file here.
        Nothing is saved until you've seen the preview and clicked Import. Importing the same file twice
        doesn't duplicate anything.
      </Alert>
      {error && <Alert tone="danger">{error}</Alert>}

      <section className="card card__body stack" aria-labelledby="file-h">
        <h2 id="file-h">1. Choose the file</h2>
        <label className="file-drop">
          <FileUp aria-hidden="true" />
          <span>{file ? file.name : "Choose a CSV file"}</span>
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => void onFile(e)} />
        </label>
        <Switch
          checked={createMissing}
          onChange={setCreateMissing}
          label="Create clients, projects, items and tags that don't exist in Stint yet"
        />
        <div className="row">
          <Button icon={<Upload />} loading={busy && !result} disabled={!file} onClick={() => void run(true)}>
            Preview
          </Button>
        </div>
      </section>

      {result && (
        <section className="card card__body stack" aria-labelledby="preview-h" aria-live="polite">
          <h2 id="preview-h">{result.dryRun ? "2. Check the preview" : "Done"}</h2>
          <p className="muted">Read as: {FORMAT[result.format]}.</p>
          <div className="stat-row">
            <div className="stat">
              <div className="stat__label">{result.dryRun ? "Will import" : "Imported"}</div>
              <div className="stat__value">{result.imported}</div>
              <div className="stat__sub">{fmtHours(result.seconds)} h</div>
            </div>
            <div className="stat">
              <div className="stat__label">Already in Stint</div>
              <div className="stat__value">{result.duplicates}</div>
              <div className="stat__sub">skipped</div>
            </div>
            <div className="stat">
              <div className="stat__label">Problems</div>
              <div className="stat__value">{result.errors.length}</div>
              <div className="stat__sub">rows not imported</div>
            </div>
          </div>

          <CreatedList label="clients" items={result.created.clients} />
          <CreatedList label="projects and items" items={result.created.projects} />
          <CreatedList label="tags" items={result.created.tags} />

          {unmatched.length > 0 && result.dryRun && (
            <div className="stack">
              <h3>Who is who?</h3>
              <p className="muted">
                These people in the file don't match anyone in Stint by email or name. Choose who they are, or
                add them on the Team page first.
              </p>
              <div className="form-grid">
                {unmatched.map((name) => (
                  <Field key={name} label={name}>
                    <Select
                      value={people[name] ?? ""}
                      onChange={(e) => setPeople({ ...people, [name]: e.target.value })}
                    >
                      <option value="">Skip their entries</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ))}
              </div>
              <div>
                <Button loading={busy} onClick={() => void run(true)}>
                  Update preview
                </Button>
              </div>
            </div>
          )}

          {result.errors.length > 0 && (
            <details open={result.errors.length <= 10}>
              <summary>
                {result.errors.length} row{result.errors.length === 1 ? "" : "s"} can't be imported
              </summary>
              <table className="table" style={{ marginTop: "var(--space-3)" }}>
                <thead>
                  <tr>
                    <th className="num">Line</th>
                    <th>Problem</th>
                  </tr>
                </thead>
                <tbody>
                  {result.errors.slice(0, 200).map((e) => (
                    <tr key={`${e.line}-${e.message}`}>
                      <td className="num">{e.line}</td>
                      <td>{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}

          {result.dryRun && result.imported > 0 && (
            <div className="row">
              <Button variant="primary" loading={busy} onClick={() => void run(false)}>
                Import {result.imported} entries
              </Button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
