import { flattenTree, type Project, subtreeIds } from "@stint/shared";
import { useState } from "react";
import { useMe } from "../../app/session.tsx";
import { useClients, useProjects, useProjectTree } from "../../data/hooks.ts";
import { Button } from "../../ui/Button.tsx";
import { Dialog } from "../../ui/Dialog.tsx";
import { Field, Select } from "../../ui/Field.tsx";

/** Keyboard-friendly alternative to drag-and-drop. */
export function MoveProjectDialog({
  project,
  onClose,
  onMove,
}: {
  project: Project;
  onClose: () => void;
  onMove: (parentId: string | null, clientId?: string) => Promise<void>;
}) {
  const me = useMe();
  const clients = useClients().filter((c) => !c.archivedAt);
  const projects = useProjects();
  const tree = useProjectTree(projects);
  const exclude = new Set(subtreeIds(tree, project.id));
  const [target, setTarget] = useState(project.parentId ? `p:${project.parentId}` : `c:${project.clientId}`);
  const [busy, setBusy] = useState(false);
  const isAdmin = me.user.role === "admin";

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Move “${project.name}”`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                if (target.startsWith("c:")) await onMove(null, target.slice(2));
                else await onMove(target.slice(2));
              } finally {
                setBusy(false);
              }
            }}
          >
            Move
          </Button>
        </>
      }
    >
      <Field label="Put it under" hint="Its sub-projects, tasks and time move with it.">
        <Select value={target} onChange={(e) => setTarget(e.target.value)}>
          {clients
            .filter((c) => isAdmin || c.id === project.clientId)
            .map((c) => (
              <optgroup key={c.id} label={c.name}>
                <option value={`c:${c.id}`}>{c.name} (top level)</option>
                {flattenTree({ ...tree, roots: tree.roots.filter((r) => r.clientId === c.id) })
                  .filter(({ node }) => !exclude.has(node.id))
                  .map(({ node, depth }) => (
                    <option key={node.id} value={`p:${node.id}`}>
                      {"  ".repeat(depth + 1)}
                      {node.name}
                    </option>
                  ))}
              </optgroup>
            ))}
        </Select>
      </Field>
    </Dialog>
  );
}
