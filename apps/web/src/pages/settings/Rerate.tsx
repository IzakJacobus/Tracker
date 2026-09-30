import { flattenTree } from "@stint/shared";
import { Calculator } from "lucide-react";
import { useState } from "react";
import { useMe } from "../../app/session.tsx";
import { useData } from "../../data/DataProvider.tsx";
import { useProjects, useProjectTree, useUsers } from "../../data/hooks.ts";
import { api, errorMessage } from "../../lib/api.ts";
import { formatMoney } from "../../lib/format.ts";
import { Button } from "../../ui/Button.tsx";
import { Field, Input, Select, Switch } from "../../ui/Field.tsx";
import { Alert } from "../../ui/misc.tsx";
import { useToast } from "../../ui/Toast.tsx";

interface Summary {
  matched: number;
  changed: number;
  skippedLocked: number;
  amountBefore: number;
  amountAfter: number;
  dryRun: boolean;
}

/** Deliberately re-price a range of entries with today's rates. */
export function ReratePage() {
  const me = useMe();
  const { mutate } = useData();
  const toast = useToast();
  const tree = useProjectTree(useProjects());
  const users = useUsers();
  const currency = me.organization?.settings.currency ?? "ZAR";
  const [f, setF] = useState({
    from: "",
    to: "",
    projectId: "",
    userId: "",
    includeLocked: false,
    reason: "",
  });
  const [preview, setPreview] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const payload = () => ({
    from: f.from,
    to: f.to,
    projectId: f.projectId || undefined,
    userId: f.userId || undefined,
    includeLocked: f.includeLocked,
    reason: f.reason,
  });

  async function run(dryRun: boolean) {
    setBusy(true);
    setError(null);
    try {
      const r = await mutate(() => api.post<Summary>("/admin/rerate", { ...payload(), dryRun }));
      setPreview(r);
      if (!dryRun) toast.success(`Updated ${r.changed} entries. The change is in the audit log.`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ maxWidth: 820 }}>
      <Alert tone="info" title="Rates are frozen on each entry">
        Each time entry keeps the rate that applied when it was saved, so changing a rate never rewrites past
        invoices. Use this tool when you really do want past entries repriced — for example after agreeing new
        rates with a client.
      </Alert>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="card card__body stack">
        <div className="form-grid">
          <Field label="From">
            <Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
          </Field>
          <Field label="To">
            <Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
          </Field>
          <Field label="Project (and sub-projects)">
            <Select value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })}>
              <option value="">All projects</option>
              {flattenTree(tree).map(({ node, depth }) => (
                <option key={node.id} value={node.id}>
                  {"  ".repeat(depth)}
                  {node.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Person">
            <Select value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })}>
              <option value="">Everyone</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Reason (kept in the audit log)">
          <Input
            value={f.reason}
            onChange={(e) => setF({ ...f, reason: e.target.value })}
            placeholder="e.g. New 2026 rate agreement with Drakenstein"
          />
        </Field>
        <Switch
          checked={f.includeLocked}
          onChange={(v) => setF({ ...f, includeLocked: v })}
          label="Also reprice submitted and approved periods"
        />
        <div className="row">
          <Button
            icon={<Calculator />}
            loading={busy}
            disabled={!f.from || !f.to}
            onClick={() => void run(true)}
          >
            Preview
          </Button>
        </div>
      </div>
      {preview && (
        <div className="card card__body stack">
          <h2>{preview.dryRun ? "Preview" : "Done"}</h2>
          <p>
            {preview.matched} entries match; <strong>{preview.changed}</strong> would change
            {preview.skippedLocked ? ` (${preview.skippedLocked} in locked periods left alone)` : ""}.
          </p>
          <p>
            Billable amount of the changed entries: {formatMoney(preview.amountBefore, currency)} →{" "}
            <strong>{formatMoney(preview.amountAfter, currency)}</strong>
          </p>
          {preview.dryRun && preview.changed > 0 && (
            <div>
              <Button variant="danger" loading={busy} onClick={() => void run(false)}>
                Apply to {preview.changed} entries
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
