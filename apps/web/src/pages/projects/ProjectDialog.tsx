import type { Project, ProjectMember, Task, User } from "@stint/shared";
import { Archive, ArchiveRestore, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useMe } from "../../app/session.tsx";
import { useData } from "../../data/DataProvider.tsx";
import { useClients, useMembers, useProjects, useTasks, useUsers } from "../../data/hooks.ts";
import { ApiError, api, errorMessage } from "../../lib/api.ts";
import { moneyInputValue, parseMoneyInput } from "../../lib/format.ts";
import { Button } from "../../ui/Button.tsx";
import { Dialog } from "../../ui/Dialog.tsx";
import { Field, Input, Select, Switch, Textarea } from "../../ui/Field.tsx";
import { Alert, Avatar, Badge } from "../../ui/misc.tsx";
import { useToast } from "../../ui/Toast.tsx";

const COLORS = [
  "#1f5c4a",
  "#2f8a6c",
  "#0f766e",
  "#2463a6",
  "#6d5bd0",
  "#a21caf",
  "#be185d",
  "#b3361f",
  "#b86e12",
  "#ca8a04",
  "#8b5a2b",
  "#475569",
];

type Tab = "details" | "tasks" | "team";

/** Select value meaning "create a new client together with this project". */
const NEW_CLIENT = "__new_client__";
/** Fields the details form shows errors next to. */
const SHOWN_FIELDS = new Set(["name", "clientId", "newClient"]);

export function ProjectDialog(
  props:
    | { mode: "new"; clientId: string | null; parentId: string | null; onClose: () => void }
    | { mode: "edit"; project: Project; initialTab?: Tab; onClose: () => void },
) {
  const [tab, setTab] = useState<Tab>(props.mode === "edit" ? (props.initialTab ?? "details") : "details");
  const projects = useProjects();
  const live =
    props.mode === "edit" ? (projects.find((p) => p.id === props.project.id) ?? props.project) : null;
  const title = live ? live.name : "New project";

  return (
    <Dialog open onClose={props.onClose} title={title} wide>
      {live && (
        <div
          className="segmented"
          role="tablist"
          aria-label="Project sections"
          style={{ alignSelf: "flex-start" }}
        >
          {(
            [
              ["details", "Details"],
              ["tasks", "Tasks"],
              ["team", "People"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </div>
      )}
      {tab === "details" && (
        <DetailsForm
          project={live}
          clientId={props.mode === "new" ? props.clientId : null}
          parentId={props.mode === "new" ? props.parentId : null}
          onDone={props.onClose}
        />
      )}
      {tab === "tasks" && live && <TasksPanel project={live} />}
      {tab === "team" && live && <TeamPanel project={live} />}
    </Dialog>
  );
}

function DetailsForm({
  project,
  clientId,
  parentId,
  onDone,
}: {
  project: Project | null;
  clientId: string | null;
  parentId: string | null;
  onDone: () => void;
}) {
  const me = useMe();
  const { mutate } = useData();
  const toast = useToast();
  const clients = useClients().filter((c) => !c.archivedAt);
  const projects = useProjects();
  const parent = parentId ? projects.find((p) => p.id === parentId) : null;
  const currency = me.organization?.settings.currency ?? "ZAR";
  const seesMoney = me.permissions.seeRates;
  const defaultClient =
    parent?.clientId ?? clientId ?? clients.find((c) => !c.isInternal)?.id ?? clients[0]?.id ?? "";
  const clientIsInternal = useCallback(
    (id: string) => clients.find((c) => c.id === id)?.isInternal ?? false,
    [clients],
  );

  const [f, setF] = useState({
    clientId: project?.clientId ?? defaultClient,
    name: project?.name ?? "",
    code: project?.code ?? "",
    color: project?.color ?? parent?.color ?? COLORS[projects.length % COLORS.length]!,
    billableDefault: project?.billableDefault ?? parent?.billableDefault ?? !clientIsInternal(defaultClient),
    visibility: project?.visibility ?? (clientIsInternal(defaultClient) ? "everyone" : "members"),
    rate: moneyInputValue(project?.rate ?? null),
    budgetHours: project?.budgetMinutes ? String(project.budgetMinutes / 60) : "",
    budgetAmount: moneyInputValue(project?.budgetAmount ?? null),
    notes: project?.notes ?? "",
  });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newClient, setNewClient] = useState("");
  const canAddClient = me.user.role === "admin";
  const creatingClient = f.clientId === NEW_CLIENT;

  // The client list loads a moment after the form opens: pick the default client then, rather
  // than submitting an empty one (which the server rejects).
  useEffect(() => {
    if (!project && !parent && !f.clientId && defaultClient) {
      const internal = clientIsInternal(defaultClient);
      setF((cur) =>
        cur.clientId
          ? cur
          : {
              ...cur,
              clientId: defaultClient,
              billableDefault: !internal,
              visibility: internal ? "everyone" : "members",
            },
      );
    }
  }, [project, parent, f.clientId, defaultClient, clientIsInternal]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    const common = {
      name: f.name,
      code: f.code.trim() || null,
      color: f.color,
      billableDefault: f.billableDefault,
      visibility: f.visibility,
      budgetMinutes: f.budgetHours.trim() ? Math.round(Number(f.budgetHours) * 60) : null,
      notes: f.notes,
      ...(seesMoney
        ? {
            rate: f.rate.trim() ? parseMoneyInput(f.rate) : null,
            budgetAmount: f.budgetAmount.trim() ? parseMoneyInput(f.budgetAmount) : null,
          }
        : {}),
    };
    try {
      if (project) {
        await mutate(() => api.patch(`/projects/${project.id}`, common));
        toast.success("Project saved.");
      } else {
        let clientId = parent ? undefined : f.clientId;
        if (!parent && creatingClient) {
          if (!newClient.trim()) {
            setFields({ newClient: "Give the new client a name." });
            return;
          }
          // Create the client first; if the project then fails, the client is kept and selected.
          let c: { id: string };
          try {
            c = await mutate(() => api.post<{ id: string }>("/clients", { name: newClient.trim() }));
          } catch (err) {
            setFields({ newClient: errorMessage(err) });
            return;
          }
          clientId = c.id;
          setF((cur) => ({ ...cur, clientId: c.id }));
          setNewClient("");
        }
        await mutate(() => api.post("/projects", { ...common, clientId, parentId }));
        toast.success(parent ? `Added “${f.name}” under “${parent.name}”.` : `Created “${f.name}”.`);
      }
      onDone();
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) {
        setFields(err.fields);
        // Errors for fields this form doesn't show must still be seen.
        if (Object.keys(err.fields).some((k) => !SHOWN_FIELDS.has(k))) setError(errorMessage(err));
      } else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit} noValidate>
      {error && <Alert tone="danger">{error}</Alert>}
      {parent && (
        <p className="muted">
          Sub-project of <strong>{parent.name}</strong>
        </p>
      )}
      <div className="grid-2">
        {!project && !parent && (
          <Field label="Client" error={fields.clientId}>
            <Select
              value={f.clientId}
              onChange={(e) => {
                const internal = clientIsInternal(e.target.value);
                setF({
                  ...f,
                  clientId: e.target.value,
                  billableDefault: !internal,
                  visibility: internal ? "everyone" : "members",
                });
              }}
            >
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              {canAddClient && <option value={NEW_CLIENT}>+ New client…</option>}
            </Select>
          </Field>
        )}
        {!project && !parent && creatingClient && (
          <Field label="New client name" error={fields.newClient}>
            <Input
              value={newClient}
              onChange={(e) => setNewClient(e.target.value)}
              placeholder="e.g. Drakenstein Municipality"
              autoFocus
            />
          </Field>
        )}
        <Field label="Name" error={fields.name}>
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
        </Field>
        <Field label="Code" hint="Optional short reference, e.g. a job number.">
          <Input
            value={f.code}
            onChange={(e) => setF({ ...f, code: e.target.value })}
            placeholder="e.g. 2026-014"
          />
        </Field>
        <Field label="Who can track time here?">
          <Select
            value={f.visibility}
            onChange={(e) => setF({ ...f, visibility: e.target.value as Project["visibility"] })}
          >
            <option value="members">Only people added to the project</option>
            <option value="everyone">Everyone in the company</option>
          </Select>
        </Field>
        <Field label="Budget (hours)" hint="Includes all sub-projects. Warns at 80 % and 100 %.">
          <Input
            type="number"
            min={0}
            step={1}
            value={f.budgetHours}
            onChange={(e) => setF({ ...f, budgetHours: e.target.value })}
            placeholder="none"
          />
        </Field>
        {seesMoney && (
          <>
            <Field label={`Budget (${currency})`}>
              <Input
                inputMode="decimal"
                value={f.budgetAmount}
                onChange={(e) => setF({ ...f, budgetAmount: e.target.value })}
                placeholder="none"
              />
            </Field>
            <Field
              label={`Hourly rate (${currency})`}
              hint="Leave empty to inherit from the parent project or client."
            >
              <Input
                inputMode="decimal"
                value={f.rate}
                onChange={(e) => setF({ ...f, rate: e.target.value })}
                placeholder="inherit"
              />
            </Field>
          </>
        )}
      </div>
      <Switch
        checked={f.billableDefault}
        onChange={(v) => setF({ ...f, billableDefault: v })}
        label="Time on this project is billable by default"
      />
      <fieldset className="stack stack--sm" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="field__label" style={{ marginBottom: 6 }}>
          Colour
        </legend>
        <div className="row row--wrap">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className="swatch"
              aria-label={`Colour ${c}`}
              aria-pressed={f.color === c}
              onClick={() => setF({ ...f, color: c })}
              style={{ background: c }}
            />
          ))}
        </div>
      </fieldset>
      <Field label="Notes">
        <Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </Field>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <Button onClick={onDone}>Cancel</Button>
        <Button type="submit" variant="primary" loading={busy}>
          {project ? "Save" : "Create project"}
        </Button>
      </div>
    </form>
  );
}

function TasksPanel({ project }: { project: Project }) {
  const me = useMe();
  const { mutate } = useData();
  const toast = useToast();
  const tasks = useTasks()
    .filter((t) => t.projectId === project.id)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const seesMoney = me.permissions.seeRates;
  const currency = me.organization?.settings.currency ?? "ZAR";

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await mutate(() => api.post("/tasks", { projectId: project.id, name: name.trim() }));
      setName("");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function patch(t: Task, body: Record<string, unknown>) {
    try {
      await mutate(() => api.patch(`/tasks/${t.id}`, body));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="stack">
      <p className="muted">
        Tasks are optional. Use them for the kinds of work on this project, e.g. <em>Design</em>,{" "}
        <em>Site visit</em>, <em>Report writing</em>. A task rate overrides every other rate.
      </p>
      <form className="row" onSubmit={add}>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New task name"
          aria-label="New task name"
        />
        <Button type="submit" icon={<Plus />} loading={busy}>
          Add task
        </Button>
      </form>
      {tasks.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Task</th>
              <th>Billable</th>
              {seesMoney && <th className="num">Rate ({currency})</th>}
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id} style={{ opacity: t.archivedAt ? 0.55 : 1 }}>
                <td>
                  <Input
                    className="input--bare"
                    defaultValue={t.name}
                    aria-label="Task name"
                    onBlur={(e) =>
                      e.target.value.trim() &&
                      e.target.value !== t.name &&
                      patch(t, { name: e.target.value.trim() })
                    }
                  />
                </td>
                <td>
                  <Select
                    value={t.billable === null ? "inherit" : t.billable ? "yes" : "no"}
                    aria-label="Billable"
                    onChange={(e) =>
                      patch(t, { billable: e.target.value === "inherit" ? null : e.target.value === "yes" })
                    }
                  >
                    <option value="inherit">
                      Same as project ({project.billableDefault ? "billable" : "non-billable"})
                    </option>
                    <option value="yes">Billable</option>
                    <option value="no">Non-billable</option>
                  </Select>
                </td>
                {seesMoney && (
                  <td className="num">
                    <Input
                      className="input--bare"
                      style={{ textAlign: "right", width: 120 }}
                      inputMode="decimal"
                      defaultValue={moneyInputValue(t.rate)}
                      placeholder="inherit"
                      aria-label="Task rate"
                      onBlur={(e) => {
                        const v = e.target.value.trim() ? parseMoneyInput(e.target.value) : null;
                        if (v !== t.rate) void patch(t, { rate: v });
                      }}
                    />
                  </td>
                )}
                <td style={{ textAlign: "right" }}>
                  <Button
                    size="sm"
                    variant="ghost"
                    iconOnly
                    label={t.archivedAt ? `Restore ${t.name}` : `Archive ${t.name}`}
                    icon={t.archivedAt ? <ArchiveRestore /> : <Archive />}
                    onClick={() =>
                      mutate(() =>
                        api.post(`/tasks/${t.id}/${t.archivedAt ? "unarchive" : "archive"}`),
                      ).catch((e) => toast.error(errorMessage(e)))
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function TeamPanel({ project }: { project: Project }) {
  const me = useMe();
  const { mutate } = useData();
  const toast = useToast();
  const users = useUsers().filter((u) => u.active);
  const members = useMembers().filter((m) => m.projectId === project.id);
  const [adding, setAdding] = useState("");
  const seesMoney = me.permissions.seeRates;
  const currency = me.organization?.settings.currency ?? "ZAR";
  const byUser = new Map(users.map((u) => [u.id, u]));
  const available = users.filter((u) => !members.some((m) => m.userId === u.id));

  async function set(
    user: User,
    body: Partial<Pick<ProjectMember, "role" | "rate">>,
    current?: ProjectMember,
  ) {
    try {
      await mutate(() =>
        api.put(`/projects/${project.id}/members/${user.id}`, {
          role: current?.role ?? "member",
          rate: current?.rate ?? null,
          ...body,
        }),
      );
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="stack">
      {project.visibility === "everyone" ? (
        <Alert tone="info">
          Everyone in the company can track time on this project. Add people here to make them project
          managers or give them a special rate.
        </Alert>
      ) : (
        <p className="muted">
          Only the people added here (and admins) can track time on this project and its sub-projects.
        </p>
      )}
      <div className="row">
        <Select value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="Person to add">
          <option value="">Choose a person…</option>
          {available.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
        <Button
          icon={<Plus />}
          disabled={!adding}
          onClick={async () => {
            const u = byUser.get(adding);
            if (u) await set(u, {});
            setAdding("");
          }}
        >
          Add
        </Button>
      </div>
      {members.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Person</th>
              <th>Role on project</th>
              {seesMoney && <th className="num">Rate on this project ({currency})</th>}
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const u = byUser.get(m.userId);
              if (!u) return null;
              return (
                <tr key={m.id}>
                  <td>
                    <div className="row">
                      <Avatar name={u.name} color={u.color} />
                      {u.name}
                      {u.role === "admin" && <Badge>Admin</Badge>}
                    </div>
                  </td>
                  <td>
                    <Select
                      value={m.role}
                      aria-label={`Role for ${u.name}`}
                      onChange={(e) => set(u, { role: e.target.value as ProjectMember["role"] }, m)}
                    >
                      <option value="member">Tracks time</option>
                      <option value="manager" disabled={u.role === "member"}>
                        Manages project{u.role === "member" ? " (needs Manager role)" : ""}
                      </option>
                    </Select>
                  </td>
                  {seesMoney && (
                    <td className="num">
                      <Input
                        className="input--bare"
                        style={{ textAlign: "right", width: 120 }}
                        inputMode="decimal"
                        defaultValue={moneyInputValue(m.rate)}
                        placeholder="standard"
                        aria-label={`Rate for ${u.name}`}
                        onBlur={(e) => {
                          const v = e.target.value.trim() ? parseMoneyInput(e.target.value) : null;
                          if (v !== m.rate) void set(u, { rate: v }, m);
                        }}
                      />
                    </td>
                  )}
                  <td style={{ textAlign: "right" }}>
                    <Button
                      size="sm"
                      variant="ghost"
                      iconOnly
                      label={`Remove ${u.name}`}
                      icon={<Trash2 />}
                      onClick={() =>
                        mutate(() => api.del(`/projects/${project.id}/members/${u.id}`)).catch((e) =>
                          toast.error(errorMessage(e)),
                        )
                      }
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
