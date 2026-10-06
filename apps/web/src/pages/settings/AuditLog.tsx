import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api.ts";
import { Button } from "../../ui/Button.tsx";
import { Field, Select } from "../../ui/Field.tsx";
import { Alert, Badge } from "../../ui/misc.tsx";

interface AuditRow {
  id: number;
  at: number;
  actorName: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string;
  ip: string;
}

const ENTITIES = [
  "",
  "time_entry",
  "timesheet",
  "project",
  "client",
  "task",
  "project_member",
  "user",
  "organization",
  "session",
  "tag",
];
const TONES: Record<string, "primary" | "danger" | "warning" | "info" | undefined> = {
  create: "primary",
  delete: "danger",
  unlock: "warning",
  reject: "warning",
  approve: "primary",
  login_failed: "danger",
  backup_restore: "warning",
};

/** What changed: the fields that differ between before and after. */
function diff(before: Record<string, unknown> | null, after: Record<string, unknown> | null): string {
  if (!before || !after) return "";
  const skip = new Set(["updatedAt", "serverSeq", "createdAt"]);
  return Object.keys(after)
    .filter((k) => !skip.has(k) && JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .map((k) => `${k}: ${fmt(before[k])} → ${fmt(after[k])}`)
    .join(" · ");
}
const fmt = (v: unknown) =>
  v === null || v === undefined
    ? "—"
    : typeof v === "object"
      ? JSON.stringify(v).slice(0, 60)
      : String(v).slice(0, 60);

export function AuditLogPage() {
  const [entity, setEntity] = useState("");
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (before?: number) => {
      try {
        const q = new URLSearchParams({ limit: "100" });
        if (entity) q.set("entity", entity);
        if (before) q.set("before", String(before));
        const r = await api.get<{ rows: AuditRow[]; next: number | null }>(`/admin/audit?${q}`);
        setRows((cur) => (before ? [...cur, ...r.rows] : r.rows));
        setNext(r.next);
      } catch (e) {
        setError(errorMessage(e));
      }
    },
    [entity],
  );
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="stack">
      <p className="muted">
        Every change to time, timesheets, projects, people and settings — who, when and what. This log can't
        be edited.
      </p>
      <div className="filters">
        <Field label="Show">
          <Select value={entity} onChange={(e) => setEntity(e.target.value)}>
            {ENTITIES.map((x) => (
              <option key={x} value={x}>
                {x ? x.replace("_", " ") : "Everything"}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="card" style={{ overflow: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>Action</th>
              <th>What</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="mono" style={{ whiteSpace: "nowrap", fontSize: 12 }}>
                  {new Date(r.at).toLocaleString("en-ZA", { dateStyle: "short", timeStyle: "short" })}
                </td>
                <td>{r.actorName ?? <span className="subtle">system</span>}</td>
                <td>
                  <Badge tone={TONES[r.action]}>{r.action.replace("_", " ")}</Badge>
                </td>
                <td>{r.entity.replace("_", " ")}</td>
                <td style={{ fontSize: 12, maxWidth: 520 }}>
                  {r.reason && <div>“{r.reason}”</div>}
                  <div className="subtle">{diff(r.before, r.after)}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {next && (
        <div>
          <Button icon={<ChevronDown />} onClick={() => void load(next)}>
            Load older
          </Button>
        </div>
      )}
    </div>
  );
}
