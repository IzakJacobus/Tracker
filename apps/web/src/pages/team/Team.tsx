import type { User } from "@stint/shared";
import { KeyRound, Pencil, UserPlus, Users } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useMe } from "../../app/session.tsx";
import { ApiError, api, errorMessage } from "../../lib/api.ts";
import { formatMoney, moneyInputValue, parseMoneyInput } from "../../lib/format.ts";
import { Button } from "../../ui/Button.tsx";
import { Dialog } from "../../ui/Dialog.tsx";
import { Field, Input, Select, Switch } from "../../ui/Field.tsx";
import { Alert, Avatar, Badge, EmptyState } from "../../ui/misc.tsx";
import { useToast } from "../../ui/Toast.tsx";

const COLORS = [
  "#1f5c4a",
  "#2f8a6c",
  "#b86e12",
  "#6d5bd0",
  "#2463a6",
  "#b3361f",
  "#0f766e",
  "#8b5a2b",
  "#475569",
  "#a21caf",
];

function randomPassword(): string {
  const words = [
    "river",
    "karoo",
    "baobab",
    "protea",
    "summit",
    "harbour",
    "granite",
    "meadow",
    "copper",
    "delta",
    "cedar",
    "ember",
  ];
  const r = () => crypto.getRandomValues(new Uint32Array(1))[0]!;
  return `${words[r() % words.length]}-${words[r() % words.length]}-${words[r() % words.length]}-${(r() % 90) + 10}`;
}

export function TeamPage() {
  const me = useMe();
  const toast = useToast();
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<User | "new" | null>(null);
  const [resetFor, setResetFor] = useState<User | null>(null);
  const isAdmin = me.user.role === "admin";
  const currency = me.organization?.settings.currency ?? "ZAR";

  const load = useCallback(() => {
    api
      .get<User[]>("/users")
      .then(setUsers)
      .catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);

  const byId = new Map((users ?? []).map((u) => [u.id, u]));

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Team</h1>
          <p>Everyone who tracks time in {me.organization?.name}.</p>
        </div>
        {isAdmin && (
          <Button variant="primary" icon={<UserPlus />} onClick={() => setEditing("new")}>
            Add person
          </Button>
        )}
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {users && users.length === 0 && (
        <EmptyState
          icon={<Users />}
          title="No one here yet"
          action={isAdmin && <Button onClick={() => setEditing("new")}>Add person</Button>}
        >
          Add the people who will track time.
        </EmptyState>
      )}
      {users && users.length > 0 && (
        <div className="card" style={{ overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Manager</th>
                <th className="num">Hours / week</th>
                {me.permissions.seeRates && <th className="num">Rate</th>}
                <th>Status</th>
                {isAdmin && <th aria-label="Actions" />}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="row">
                      <Avatar name={u.name} color={u.color} />
                      <div>
                        <div style={{ fontWeight: 500 }}>{u.name}</div>
                        <div className="subtle" style={{ fontSize: 12 }}>
                          {u.email}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td style={{ textTransform: "capitalize" }}>{u.role}</td>
                  <td>
                    {u.managerId ? (byId.get(u.managerId)?.name ?? "—") : <span className="subtle">—</span>}
                  </td>
                  <td className="num tnum">{(u.weeklyCapacityMinutes / 60).toFixed(1)}</td>
                  {me.permissions.seeRates && (
                    <td className="num tnum">
                      {u.rate === null ? (
                        <span className="subtle">default</span>
                      ) : (
                        formatMoney(u.rate, currency)
                      )}
                    </td>
                  )}
                  <td>
                    {u.active ? (
                      u.mustChangePassword ? (
                        <Badge tone="info">Invited</Badge>
                      ) : (
                        <Badge tone="primary">Active</Badge>
                      )
                    ) : (
                      <Badge>Deactivated</Badge>
                    )}
                  </td>
                  {isAdmin && (
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <Button
                        size="sm"
                        variant="ghost"
                        iconOnly
                        label={`Edit ${u.name}`}
                        icon={<Pencil />}
                        onClick={() => setEditing(u)}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        iconOnly
                        label={`Reset password for ${u.name}`}
                        icon={<KeyRound />}
                        onClick={() => setResetFor(u)}
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <UserDialog
          user={editing === "new" ? null : editing}
          users={users ?? []}
          currency={currency}
          onClose={() => setEditing(null)}
          onSaved={(msg) => {
            setEditing(null);
            toast.success(msg);
            load();
          }}
        />
      )}
      {resetFor && <ResetDialog user={resetFor} onClose={() => setResetFor(null)} />}
    </div>
  );
}

function UserDialog({
  user,
  users,
  currency,
  onClose,
  onSaved,
}: {
  user: User | null;
  users: User[];
  currency: string;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [f, setF] = useState({
    name: user?.name ?? "",
    email: user?.email ?? "",
    role: user?.role ?? ("member" as User["role"]),
    managerId: user?.managerId ?? "",
    hours: String((user?.weeklyCapacityMinutes ?? 2400) / 60),
    rate: moneyInputValue(user?.rate ?? null),
    color: user?.color ?? COLORS[users.length % COLORS.length]!,
    active: user?.active ?? true,
  });
  const [password] = useState(randomPassword);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    const payload = {
      name: f.name,
      email: f.email,
      role: f.role,
      managerId: f.managerId || null,
      weeklyCapacityMinutes: Math.round(Number(f.hours) * 60),
      rate: f.rate.trim() ? parseMoneyInput(f.rate) : null,
      color: f.color,
    };
    try {
      if (user) {
        await api.patch(`/users/${user.id}`, { ...payload, active: f.active });
        onSaved(`${f.name} updated.`);
      } else {
        await api.post("/users", { ...payload, password });
        setCreated(true);
      }
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setFields(err.fields);
      else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <Dialog
        open
        onClose={() => onSaved(`${f.name} added.`)}
        title={`${f.name} can now sign in`}
        footer={
          <Button variant="primary" onClick={() => onSaved(`${f.name} added.`)}>
            Done
          </Button>
        }
      >
        <p>
          Give {f.name.split(" ")[0]} these details privately. They'll be asked to choose their own password.
        </p>
        <div className="card card__body stack stack--sm">
          <div>
            <span className="subtle">Email</span> <strong>{f.email}</strong>
          </div>
          <div>
            <span className="subtle">Temporary password</span> <code className="mono">{password}</code>
          </div>
        </div>
      </Dialog>
    );
  }

  const managers = users.filter((u) => u.id !== user?.id && u.role !== "member" && u.active);
  return (
    <Dialog
      open
      onClose={onClose}
      title={user ? `Edit ${user.name}` : "Add a person"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="user-form" loading={busy}>
            {user ? "Save" : "Add person"}
          </Button>
        </>
      }
    >
      <form id="user-form" className="stack" onSubmit={submit} noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="grid-2">
          <Field label="Name" error={fields.name}>
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
          </Field>
          <Field label="Email" error={fields.email}>
            <Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </Field>
          <Field
            label="Role"
            hint={
              f.role === "admin"
                ? "Can do everything, including settings and backups."
                : f.role === "manager"
                  ? "Manages assigned projects, approves their team's timesheets, sees rates."
                  : "Tracks their own time and sees their own reports."
            }
          >
            <Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as User["role"] })}>
              <option value="member">Member</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
            </Select>
          </Field>
          <Field label="Reports to" hint="Their manager approves their timesheets.">
            <Select value={f.managerId} onChange={(e) => setF({ ...f, managerId: e.target.value })}>
              <option value="">— No manager —</option>
              {managers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Expected hours per week" error={fields.weeklyCapacityMinutes}>
            <Input
              type="number"
              min={0}
              max={80}
              step={0.5}
              value={f.hours}
              onChange={(e) => setF({ ...f, hours: e.target.value })}
            />
          </Field>
          <Field
            label={`Hourly rate (${currency})`}
            hint="Leave empty to use project, client or company rates."
          >
            <Input
              inputMode="decimal"
              value={f.rate}
              onChange={(e) => setF({ ...f, rate: e.target.value })}
              placeholder="default"
            />
          </Field>
        </div>
        <fieldset className="stack stack--sm" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field__label" style={{ marginBottom: 6 }}>
            Colour
          </legend>
          <div className="row row--wrap">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Colour ${c}`}
                aria-pressed={f.color === c}
                onClick={() => setF({ ...f, color: c })}
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  border: f.color === c ? "2px solid var(--text)" : "2px solid transparent",
                  outline: "2px solid var(--surface)",
                  outlineOffset: -4,
                  background: c,
                  cursor: "pointer",
                }}
              />
            ))}
          </div>
        </fieldset>
        {user && (
          <Switch
            checked={f.active}
            onChange={(v) => setF({ ...f, active: v })}
            label="Active (can sign in and track time)"
          />
        )}
      </form>
    </Dialog>
  );
}

function ResetDialog({ user, onClose }: { user: User; onClose: () => void }) {
  const [password] = useState(randomPassword);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Reset password for ${user.name}`}
      footer={
        done ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api.post(`/users/${user.id}/reset-password`, { password });
                  setDone(true);
                } catch (e) {
                  setError(errorMessage(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Reset password
            </Button>
          </>
        )
      }
    >
      {error && <Alert tone="danger">{error}</Alert>}
      {done ? (
        <p>
          The new temporary password is <code className="mono">{password}</code>. {user.name.split(" ")[0]}{" "}
          will be signed out everywhere and asked to choose a new password.
        </p>
      ) : (
        <p>
          {user.name} will get a new temporary password and be signed out on all their devices. Their time
          entries are not affected.
        </p>
      )}
    </Dialog>
  );
}
