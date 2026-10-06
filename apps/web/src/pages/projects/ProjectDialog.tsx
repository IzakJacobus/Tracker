import type { Project, ProjectMember, User } from "@stint/shared";
import { CheckCircle2, ChevronRight, Plus, RotateCcw, Trash2 } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useMe } from "../../app/session.tsx";
import { useData } from "../../data/DataProvider.tsx";
import { useClients, useMembers, useProjects, useUsers } from "../../data/hooks.ts";
import { ApiError, api, errorMessage } from "../../lib/api.ts";
import { Button } from "../../ui/Button.tsx";
import { Dialog } from "../../ui/Dialog.tsx";
import { Field, Input, Select, Textarea } from "../../ui/Field.tsx";
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

export type Tab = "details" | "items" | "team";

/** Types offered for new items; a firm can type anything else, and its own types are suggested too. */
const DEFAULT_KINDS = ["Phase", "Task", "Work package", "Deliverable", "Stage"];

/** Item types already used in the company, then the defaults. */
export function useKindSuggestions(): string[] {
  const projects = useProjects();
  return useMemo(() => {
    const used = projects.map((p) => p.kind).filter((k): k is string => Boolean(k));
    return [...new Set([...used, ...DEFAULT_KINDS])];
  }, [projects]);
}

function KindList({ id }: { id: string }) {
  const kinds = useKindSuggestions();
  return (
    <datalist id={id}>
      {kinds.map((k) => (
        <option key={k} value={k} />
      ))}
    </datalist>
  );
}

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
  const isItem = props.mode === "edit" ? Boolean(props.project.parentId) : Boolean(props.parentId);
  const title = live ? live.name : isItem ? "New item" : "New project";

  return (
    <Dialog open onClose={props.onClose} title={title} wide>
      {live && (
        <div
          className="segmented"
          role="tablist"
          aria-label={isItem ? "Item sections" : "Project sections"}
          style={{ alignSelf: "flex-start" }}
        >
          {(
            [
              ["details", "Details"],
              ["items", "Items"],
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
      {tab === "items" && live && <ItemsPanel project={live} />}
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
  const defaultClient =
    parent?.clientId ?? clientId ?? clients.find((c) => !c.isInternal)?.id ?? clients[0]?.id ?? "";
  const clientIsInternal = useCallback(
    (id: string) => clients.find((c) => c.id === id)?.isInternal ?? false,
    [clients],
  );

  const isItem = Boolean(parent ?? project?.parentId);
  const [f, setF] = useState({
    clientId: project?.clientId ?? defaultClient,
    name: project?.name ?? "",
    code: project?.code ?? "",
    kind: project?.kind ?? "",
    color: project?.color ?? parent?.color ?? COLORS[projects.length % COLORS.length]!,
    visibility: project?.visibility ?? (clientIsInternal(defaultClient) ? "everyone" : "members"),
    budgetHours: project?.budgetMinutes ? String(project.budgetMinutes / 60) : "",
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
      kind: f.kind.trim() || null,
      color: f.color,
      visibility: f.visibility,
      budgetMinutes: f.budgetHours.trim() ? Math.round(Number(f.budgetHours) * 60) : null,
      notes: f.notes,
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
      <KindList id="item-kinds" />
      {error && <Alert tone="danger">{error}</Alert>}
      {parent && (
        <p className="muted">
          An item under <strong>{parent.name}</strong>. Add items under it later to go another level deeper.
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
        <Field label="Type" hint={isItem ? "What your firm calls it, e.g. Phase or Task." : "Optional."}>
          <Input
            value={f.kind}
            onChange={(e) => setF({ ...f, kind: e.target.value })}
            placeholder={isItem ? "e.g. Phase, Task" : "e.g. Project, Tender"}
            list="item-kinds"
            maxLength={40}
          />
        </Field>
        <Field label="Code" hint="Optional short reference, e.g. a job number.">
          <Input
            value={f.code}
            onChange={(e) => setF({ ...f, code: e.target.value })}
            placeholder="e.g. 2026-014"
          />
        </Field>
        {!isItem && (
          <Field label="Who can log hours here?">
            <Select
              value={f.visibility}
              onChange={(e) => setF({ ...f, visibility: e.target.value as Project["visibility"] })}
            >
              <option value="members">Only people added to the project</option>
              <option value="everyone">Everyone in the company</option>
            </Select>
          </Field>
        )}
        <Field label="Budget (hours)" hint="Includes everything under it. Warns at 80 % and 100 %.">
          <Input
            type="number"
            min={0}
            step={1}
            value={f.budgetHours}
            onChange={(e) => setF({ ...f, budgetHours: e.target.value })}
            placeholder="none"
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
          {project ? "Save" : isItem ? "Add item" : "Create project"}
        </Button>
      </div>
    </form>
  );
}

/** The items directly under a project or item: add, rename, retype, and mark them done or reopen them. */
function ItemsPanel({ project }: { project: Project }) {
  const { mutate } = useData();
  const toast = useToast();
  const projects = useProjects();
  const items = projects
    .filter((p) => p.parentId === project.id && !p.deletedAt)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const childCount = (id: string) => projects.filter((p) => p.parentId === id && !p.deletedAt).length;
  const [name, setName] = useState("");
  const [kind, setKind] = useState("");
  const [busy, setBusy] = useState(false);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await mutate(() =>
        api.post("/projects", { parentId: project.id, name: name.trim(), kind: kind.trim() || null }),
      );
      setName("");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function patch(p: Project, body: Record<string, unknown>) {
    try {
      await mutate(() => api.patch(`/projects/${p.id}`, body));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="stack">
      <p className="muted">
        Break the work down as far as you need: phases, tasks, work packages… Call them whatever your firm
        calls them. People log hours on the lowest level. Mark an item <strong>done</strong> when its work is
        finished; it then can't take new hours, but its hours stay in reports.
      </p>
      <form className="row row--wrap" onSubmit={add}>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New item name"
          aria-label="New item name"
          style={{ flex: "2 1 200px" }}
        />
        <Input
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          placeholder="Type (optional)"
          aria-label="New item type"
          list="new-item-kinds"
          maxLength={40}
          style={{ flex: "1 1 120px" }}
        />
        <KindList id="new-item-kinds" />
        <Button type="submit" icon={<Plus />} loading={busy}>
          Add item
        </Button>
      </form>
      {items.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Type</th>
              <th aria-label="Status" />
            </tr>
          </thead>
          <tbody>
            {items.map((t) => {
              const n = childCount(t.id);
              return (
                <tr key={t.id} style={{ opacity: t.archivedAt ? 0.55 : 1 }}>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <Input
                        className="input--bare"
                        defaultValue={t.name}
                        aria-label="Item name"
                        onBlur={(e) =>
                          e.target.value.trim() &&
                          e.target.value !== t.name &&
                          patch(t, { name: e.target.value.trim() })
                        }
                      />
                      {n > 0 && (
                        <span className="subtle row" style={{ gap: 2, whiteSpace: "nowrap" }}>
                          {n} under it <ChevronRight size={14} />
                        </span>
                      )}
                    </div>
                  </td>
                  <td>
                    <Input
                      className="input--bare"
                      defaultValue={t.kind ?? ""}
                      placeholder="—"
                      aria-label="Item type"
                      list="row-item-kinds"
                      maxLength={40}
                      onBlur={(e) => {
                        const v = e.target.value.trim() || null;
                        if (v !== (t.kind ?? null)) void patch(t, { kind: v });
                      }}
                    />
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={t.archivedAt ? <RotateCcw /> : <CheckCircle2 />}
                      onClick={() =>
                        mutate(() => api.post(`/projects/${t.id}/${t.archivedAt ? "unarchive" : "archive"}`))
                          .then(() =>
                            toast.show(t.archivedAt ? `Reopened “${t.name}”.` : `Marked “${t.name}” done.`),
                          )
                          .catch((e) => toast.error(errorMessage(e)))
                      }
                    >
                      {t.archivedAt ? "Reopen" : "Mark done"}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <KindList id="row-item-kinds" />
    </div>
  );
}

function TeamPanel({ project }: { project: Project }) {
  const _me = useMe();
  const { mutate } = useData();
  const toast = useToast();
  const users = useUsers().filter((u) => u.active);
  const members = useMembers().filter((m) => m.projectId === project.id);
  const [adding, setAdding] = useState("");
  const byUser = new Map(users.map((u) => [u.id, u]));
  const available = users.filter((u) => !members.some((m) => m.userId === u.id));

  async function set(user: User, body: Partial<Pick<ProjectMember, "role">>, current?: ProjectMember) {
    try {
      await mutate(() =>
        api.put(`/projects/${project.id}/members/${user.id}`, {
          role: current?.role ?? "member",
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
          Everyone in the company can log hours on this project. Add people here to make them project
          managers.
        </Alert>
      ) : (
        <p className="muted">
          Only the people added here (and admins) can log hours on this project and everything under it.
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
