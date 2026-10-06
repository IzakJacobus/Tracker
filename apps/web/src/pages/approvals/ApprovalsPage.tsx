import {
  canApproveTimesheet,
  formatDuration,
  monthlyTimesheet,
  type Timesheet,
  type User,
} from "@stint/shared";
import { useLiveQuery } from "dexie-react-hooks";
import { Check, CheckSquare, Eye, LockOpen, Undo2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useMe } from "../../app/session.tsx";
import { useData, useSyncStatus } from "../../data/DataProvider.tsx";
import { useUsers } from "../../data/hooks.ts";
import { api, errorMessage } from "../../lib/api.ts";
import { Button } from "../../ui/Button.tsx";
import { Dialog } from "../../ui/Dialog.tsx";
import { Field, Textarea } from "../../ui/Field.tsx";
import { Alert, Avatar, Badge, EmptyState } from "../../ui/misc.tsx";
import { useToast } from "../../ui/Toast.tsx";
import { useReportData } from "../reports/data.ts";
import { rangeLabel } from "../track/WeekHeader.tsx";

type Action = { kind: "reject" | "unlock"; sheet: Timesheet } | { kind: "review"; sheet: Timesheet } | null;

export function ApprovalsPage() {
  const me = useMe();
  const { db, mutate } = useData();
  const sync = useSyncStatus();
  const toast = useToast();
  const navigate = useNavigate();
  const users = useUsers();
  const sheets = useLiveQuery(() => db.timesheets.toArray(), [db]) ?? [];
  const entries = useLiveQuery(() => db.timeEntries.toArray(), [db]) ?? [];
  const [action, setAction] = useState<Action>(null);
  const byUser = new Map(users.map((u) => [u.id, u]));
  const actor = { id: me.user.id, role: me.user.role };
  const access = useMemo(
    () => ({
      projectParent: new Map(),
      projectVisibility: new Map(),
      memberships: new Map(),
      userManager: new Map(users.map((u) => [u.id, u.managerId])),
      membersSeeOwnRates: false,
    }),
    [users],
  );
  const hours = (t: Timesheet) =>
    entries
      .filter(
        (e) =>
          e.userId === t.userId && e.entryDate >= t.periodStart && e.entryDate <= t.periodEnd && !e.deletedAt,
      )
      .reduce((acc, e) => ({ total: acc.total + (e.durationS ?? 0) }), { total: 0 });
  const mine = (t: Timesheet) => canApproveTimesheet(actor, t.userId, access);
  const waiting = sheets
    .filter((t) => t.status === "submitted" && mine(t))
    .sort((a, b) => a.periodStart.localeCompare(b.periodStart));
  const decided = sheets
    .filter(
      (t) => (t.status === "approved" || t.status === "rejected") && (me.user.role === "admin" || mine(t)),
    )
    .sort((a, b) => (b.decidedAt ?? 0) - (a.decidedAt ?? 0))
    .slice(0, 30);
  const offline = sync.state === "offline";

  async function approve(t: Timesheet) {
    try {
      await mutate(() => api.post(`/timesheets/${t.id}/approve`, {}));
      toast.success(
        `Approved ${byUser.get(t.userId)?.name ?? ""} · ${rangeLabel(t.periodStart, t.periodEnd)}.`,
      );
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const row = (t: Timesheet, actions: React.ReactNode) => {
    const u = byUser.get(t.userId);
    const h = hours(t);
    return (
      <tr key={t.id}>
        <td>
          <div className="row">
            {u && <Avatar name={u.name} color={u.color} />}
            {u?.name ?? "Unknown"}
          </div>
        </td>
        <td>{rangeLabel(t.periodStart, t.periodEnd)}</td>
        <td className="num mono">{formatDuration(h.total)}</td>
        <td>
          {t.status === "approved" ? (
            <Badge tone="primary">Approved</Badge>
          ) : t.status === "rejected" ? (
            <Badge tone="danger" title={t.comment}>
              Sent back
            </Badge>
          ) : (
            <Badge tone="info">Waiting</Badge>
          )}
        </td>
        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{actions}</td>
      </tr>
    );
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Approvals</h1>
          <p>Check and approve your team's timesheets. Approved periods are locked.</p>
        </div>
      </div>
      {offline && (
        <Alert tone="warning">
          You're offline. You can look at timesheets, but approving needs a connection.
        </Alert>
      )}
      <section className="card" style={{ overflow: "auto" }}>
        <div className="card__header">
          <h2>Waiting for you</h2>
          <Badge tone={waiting.length ? "live" : undefined}>{waiting.length}</Badge>
        </div>
        {waiting.length === 0 ? (
          <EmptyState icon={<CheckSquare />} title="Nothing to approve">
            When someone in your team submits a timesheet, it appears here.
          </EmptyState>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Person</th>
                <th>Period</th>
                <th className="num">Hours</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {waiting.map((t) =>
                row(
                  t,
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Eye />}
                      onClick={() => setAction({ kind: "review", sheet: t })}
                    >
                      Review
                    </Button>
                    <Button
                      size="sm"
                      icon={<Undo2 />}
                      disabled={offline}
                      onClick={() => setAction({ kind: "reject", sheet: t })}
                    >
                      Send back
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      icon={<Check />}
                      disabled={offline}
                      onClick={() => void approve(t)}
                    >
                      Approve
                    </Button>
                  </>,
                ),
              )}
            </tbody>
          </table>
        )}
      </section>

      <section className="card" style={{ overflow: "auto" }}>
        <div className="card__header">
          <h2>Recently decided</h2>
        </div>
        {decided.length === 0 ? (
          <p className="subtle card__body">No decisions yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Person</th>
                <th>Period</th>
                <th className="num">Hours</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {decided.map((t) =>
                row(
                  t,
                  me.user.role === "admin" && t.status === "approved" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<LockOpen />}
                      disabled={offline}
                      onClick={() => setAction({ kind: "unlock", sheet: t })}
                    >
                      Unlock
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Eye />}
                      onClick={() =>
                        navigate(`/reports/monthly?user=${t.userId}&month=${t.periodStart.slice(0, 7)}`)
                      }
                    >
                      Open
                    </Button>
                  ),
                ),
              )}
            </tbody>
          </table>
        )}
      </section>

      {action?.kind === "review" && (
        <ReviewDialog
          sheet={action.sheet}
          user={byUser.get(action.sheet.userId)}
          onClose={() => setAction(null)}
          onApprove={() => {
            void approve(action.sheet);
            setAction(null);
          }}
          onReject={() => setAction({ kind: "reject", sheet: action.sheet })}
          offline={offline}
        />
      )}
      {(action?.kind === "reject" || action?.kind === "unlock") && (
        <ReasonDialog
          kind={action.kind}
          sheet={action.sheet}
          user={byUser.get(action.sheet.userId)}
          onClose={() => setAction(null)}
          onDone={() => setAction(null)}
        />
      )}
    </div>
  );
}

function ReviewDialog({
  sheet,
  user,
  onClose,
  onApprove,
  onReject,
  offline,
}: {
  sheet: Timesheet;
  user: User | undefined;
  onClose: () => void;
  onApprove: () => void;
  onReject: () => void;
  offline: boolean;
}) {
  const data = useReportData();
  const m = useMemo(
    () => (data ? monthlyTimesheet(data, sheet.userId, sheet.periodStart.slice(0, 7)) : null),
    [data, sheet],
  );
  const lines = m?.lines.filter((l) => l.date >= sheet.periodStart && l.date <= sheet.periodEnd) ?? [];
  const byProject = new Map<string, { path: string; total: number }>();
  for (const l of lines) {
    const p = byProject.get(l.entry.projectId) ?? { path: l.projectPath, total: 0 };
    p.total += l.seconds;
    byProject.set(l.entry.projectId, p);
  }
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={`${user?.name ?? "Timesheet"} · ${rangeLabel(sheet.periodStart, sheet.periodEnd)}`}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button icon={<Undo2 />} disabled={offline} onClick={onReject}>
            Send back
          </Button>
          <Button variant="primary" icon={<Check />} disabled={offline} onClick={onApprove}>
            Approve
          </Button>
        </>
      }
    >
      <table className="table">
        <thead>
          <tr>
            <th>Worked on</th>
            <th className="num">Hours</th>
          </tr>
        </thead>
        <tbody>
          {[...byProject.values()]
            .sort((a, b) => b.total - a.total)
            .map((p) => (
              <tr key={p.path}>
                <td>{p.path}</td>
                <td className="num mono">{formatDuration(p.total)}</td>
              </tr>
            ))}
        </tbody>
        <tfoot>
          <tr>
            <td>Total</td>
            <td className="num mono">{formatDuration(lines.reduce((s, l) => s + l.seconds, 0))}</td>
          </tr>
        </tfoot>
      </table>
      <p className="subtle" style={{ fontSize: "var(--text-sm)" }}>
        {lines.length} entries. For the full day-by-day list, open Reports → Monthly timesheet.
      </p>
    </Dialog>
  );
}

function ReasonDialog({
  kind,
  sheet,
  user,
  onClose,
  onDone,
}: {
  kind: "reject" | "unlock";
  sheet: Timesheet;
  user: User | undefined;
  onClose: () => void;
  onDone: () => void;
}) {
  const { mutate } = useData();
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = user?.name ?? "this person";
  return (
    <Dialog
      open
      onClose={onClose}
      title={kind === "reject" ? `Send back to ${name}` : `Unlock ${name}'s timesheet`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant={kind === "reject" ? "primary" : "danger"}
            loading={busy}
            disabled={!text.trim()}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await mutate(() =>
                  api.post(
                    `/timesheets/${sheet.id}/${kind}`,
                    kind === "reject" ? { comment: text } : { reason: text },
                  ),
                );
                toast.success(
                  kind === "reject"
                    ? `Sent back to ${name}.`
                    : "Unlocked. The change is recorded in the audit log.",
                );
                onDone();
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {kind === "reject" ? "Send back" : "Unlock"}
          </Button>
        </>
      }
    >
      {error && <Alert tone="danger">{error}</Alert>}
      <p>
        {kind === "reject"
          ? `${name} will see your comment on their Track page and can fix their entries before submitting again.`
          : `Unlocking lets ${name} change time in ${rangeLabel(sheet.periodStart, sheet.periodEnd)} again. It will need to be submitted and approved again.`}
      </p>
      <Field label={kind === "reject" ? "What needs to change?" : "Reason (kept in the audit log)"}>
        <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      </Field>
    </Dialog>
  );
}
