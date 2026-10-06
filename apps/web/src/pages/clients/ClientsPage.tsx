import type { Client } from "@stint/shared";
import { Archive, ArchiveRestore, Building2, Pencil, Plus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useMe } from "../../app/session.tsx";
import { useData } from "../../data/DataProvider.tsx";
import { useClients, useProjects } from "../../data/hooks.ts";
import { ApiError, api, errorMessage } from "../../lib/api.ts";
import { Button } from "../../ui/Button.tsx";
import { Dialog } from "../../ui/Dialog.tsx";
import { Field, Input, Switch, Textarea } from "../../ui/Field.tsx";
import { Alert, Badge, EmptyState } from "../../ui/misc.tsx";
import { useToast } from "../../ui/Toast.tsx";

export function ClientsPage() {
  const _me = useMe();
  const { mutate } = useData();
  const toast = useToast();
  const clients = useClients();
  const projects = useProjects();
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Client | "new" | null>(null);
  const list = clients
    .filter((c) => showArchived || !c.archivedAt)
    .sort((a, b) => Number(b.isInternal) - Number(a.isInternal) || a.name.localeCompare(b.name));

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Clients</h1>
          <p>The companies you do work for. Your own work lives under the built-in Internal client.</p>
        </div>
        <Button variant="primary" icon={<Plus />} onClick={() => setEditing("new")}>
          New client
        </Button>
      </div>
      <Switch checked={showArchived} onChange={setShowArchived} label="Show archived" />
      {list.length === 0 ? (
        <EmptyState
          icon={<Building2 />}
          title="No clients yet"
          action={<Button onClick={() => setEditing("new")}>Add a client</Button>}
        >
          Add the companies you bill.
        </EmptyState>
      ) : (
        <div className="card" style={{ overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Code</th>
                <th className="num">Projects</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} style={{ opacity: c.archivedAt ? 0.6 : 1 }}>
                  <td>
                    <div className="row">
                      <strong style={{ fontWeight: 500 }}>{c.name}</strong>
                      {c.isInternal && <Badge tone="info">Internal</Badge>}
                      {c.archivedAt && <Badge>Archived</Badge>}
                    </div>
                  </td>
                  <td className="mono subtle">{c.code ?? ""}</td>
                  <td className="num tnum">
                    {projects.filter((p) => p.clientId === c.id && !p.archivedAt).length}
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <Button
                      size="sm"
                      variant="ghost"
                      iconOnly
                      label={`Edit ${c.name}`}
                      icon={<Pencil />}
                      onClick={() => setEditing(c)}
                    />
                    {!c.isInternal && (
                      <Button
                        size="sm"
                        variant="ghost"
                        iconOnly
                        label={c.archivedAt ? `Restore ${c.name}` : `Archive ${c.name}`}
                        icon={c.archivedAt ? <ArchiveRestore /> : <Archive />}
                        onClick={async () => {
                          try {
                            await mutate(() =>
                              api.post(`/clients/${c.id}/${c.archivedAt ? "unarchive" : "archive"}`),
                            );
                            toast.success(
                              c.archivedAt
                                ? `Restored ${c.name}.`
                                : `Archived ${c.name}. Its projects and time are kept.`,
                            );
                          } catch (e) {
                            toast.error(errorMessage(e));
                          }
                        }}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <ClientDialog client={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function ClientDialog({ client, onClose }: { client: Client | null; onClose: () => void }) {
  const { mutate } = useData();
  const toast = useToast();
  const [f, setF] = useState({
    name: client?.name ?? "",
    code: client?.code ?? "",
    notes: client?.notes ?? "",
  });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const payload = {
      name: f.name,
      code: f.code.trim() || null,
      notes: f.notes,
    };
    try {
      if (client) await mutate(() => api.patch(`/clients/${client.id}`, payload));
      else await mutate(() => api.post("/clients", payload));
      toast.success(client ? "Client saved." : `Added ${f.name}.`);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setFields(err.fields);
      else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={client ? `Edit ${client.name}` : "New client"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="client-form" loading={busy}>
            {client ? "Save" : "Add client"}
          </Button>
        </>
      }
    >
      <form id="client-form" className="stack" onSubmit={submit} noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Name" error={fields.name}>
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
        </Field>
        <Field label="Code" hint="Optional short reference for the client.">
          <Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
        </Field>
        <Field label="Notes">
          <Textarea rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
      </form>
    </Dialog>
  );
}
