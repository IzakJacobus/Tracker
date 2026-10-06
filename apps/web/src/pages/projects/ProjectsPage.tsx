import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  budgetStatus,
  type Client,
  canCreateProject,
  canManageProject,
  flattenTree,
  type Project,
  rollup,
  type Totals,
  wouldCreateCycle,
  zeroTotals,
} from "@stint/shared";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Archive,
  ArchiveRestore,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FolderPlus,
  FolderTree,
  GripVertical,
  ListTree,
  MoreHorizontal,
  MoveRight,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Users as UsersIcon,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useMe } from "../../app/session.tsx";
import { accessFromLocal } from "../../data/access.ts";
import { useData } from "../../data/DataProvider.tsx";
import { useClients, useMembers, useProjects, useProjectTree } from "../../data/hooks.ts";
import { api, errorMessage } from "../../lib/api.ts";
import { fmtHours } from "../../lib/format.ts";
import { Button } from "../../ui/Button.tsx";
import { Input, Switch } from "../../ui/Field.tsx";
import { Badge, Dot, EmptyState, Progress } from "../../ui/misc.tsx";
import { Menu, Popover } from "../../ui/Popover.tsx";
import { useToast } from "../../ui/Toast.tsx";
import { MoveProjectDialog } from "./MoveProjectDialog.tsx";
import { ProjectDialog, type Tab } from "./ProjectDialog.tsx";

type DialogState =
  | { kind: "new"; clientId: string | null; parentId: string | null }
  | { kind: "edit"; project: Project; tab?: Tab }
  | { kind: "move"; project: Project }
  | null;

export function ProjectsPage() {
  const me = useMe();
  const { db, mutate } = useData();
  const toast = useToast();
  const clients = useClients();
  const projects = useProjects();
  const members = useMembers();
  const tree = useProjectTree(projects);
  const entries = useLiveQuery(() => db.timeEntries.toArray(), [db]) ?? [];
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<DialogState>(null);
  const actor = { id: me.user.id, role: me.user.role };
  const access = useMemo(() => accessFromLocal(projects, members, me), [projects, members, me]);

  const totals = useMemo(() => {
    const own = new Map<string, Totals>();
    for (const e of entries) {
      if (e.durationS === null) continue;
      const t = own.get(e.projectId) ?? zeroTotals();
      own.set(e.projectId, {
        seconds: t.seconds + e.durationS,
        entries: t.entries + 1,
      });
    }
    return rollup(tree, own);
  }, [entries, tree]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  async function move(project: Project, parentId: string | null, clientId?: string) {
    try {
      await mutate(() => api.post(`/projects/${project.id}/move`, { parentId, clientId }));
      toast.success(`Moved “${project.name}”.`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  function onDragEnd(e: DragEndEvent) {
    const project = tree.byId.get(String(e.active.id));
    const over = e.over?.id ? String(e.over.id) : null;
    if (!project || !over) return;
    if (over.startsWith("client:")) {
      const clientId = over.slice(7);
      if (project.parentId === null && project.clientId === clientId) return;
      void move(project, null, clientId);
      return;
    }
    const targetId = over.slice(8); // "project:"
    if (targetId === project.id || project.parentId === targetId) return;
    if (wouldCreateCycle(tree, project.id, targetId)) {
      toast.error("A project can't be moved inside itself.");
      return;
    }
    void move(project, targetId);
  }

  const q = search.trim().toLowerCase();
  // A node is shown if it or any descendant matches the search.
  const visibleIds = useMemo(() => {
    const matches = (p: Project) =>
      !q || p.name.toLowerCase().includes(q) || (p.code ?? "").toLowerCase().includes(q);
    const show = new Set<string>();
    for (const { node } of flattenTree(tree)) {
      if (!showArchived && node.archivedAt) continue;
      if (matches(node)) {
        let cur: Project | undefined = node;
        while (cur) {
          show.add(cur.id);
          cur = cur.parentId ? tree.byId.get(cur.parentId) : undefined;
        }
      }
    }
    return show;
  }, [tree, q, showArchived]);

  const sortedClients = [...clients]
    .filter((c) => showArchived || !c.archivedAt)
    .sort((a, b) => Number(b.isInternal) - Number(a.isInternal) || a.name.localeCompare(b.name));
  const canAddTopLevel = canCreateProject(actor, null, access);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Projects</h1>
          <p>
            Projects belong to a client and can be nested as deep as you need: project › sub-project › work
            package.
          </p>
        </div>
        {canAddTopLevel && (
          <Button
            variant="primary"
            icon={<FolderPlus />}
            onClick={() => setDialog({ kind: "new", clientId: null, parentId: null })}
          >
            New project
          </Button>
        )}
      </div>

      <div className="row row--wrap" style={{ gap: 16 }}>
        <div className="input-affix" style={{ width: 280 }}>
          <Search />
          <Input
            placeholder="Search projects"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search projects"
          />
        </div>
        <Switch checked={showArchived} onChange={setShowArchived} label="Show done and archived" />
        {canAddTopLevel && (
          <span className="subtle" style={{ fontSize: "var(--text-sm)", marginLeft: "auto" }}>
            Tip: drag a project onto another to make it a sub-project, or onto a client to move it to the top.
          </span>
        )}
      </div>

      {projects.length === 0 && (
        <EmptyState
          icon={<FolderTree />}
          title="No projects yet"
          action={
            canAddTopLevel && (
              <Button
                variant="primary"
                icon={<FolderPlus />}
                onClick={() => setDialog({ kind: "new", clientId: null, parentId: null })}
              >
                Create your first project
              </Button>
            )
          }
        >
          {canAddTopLevel
            ? "Create a project for each piece of client work, then add items under it (phases, tasks… as deep as you need)."
            : "You haven't been added to any projects yet. Ask your manager to add you."}
        </EmptyState>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragEnd={onDragEnd}
        autoScroll={{ threshold: { x: 0, y: 0.08 } }}
      >
        <div className="stack">
          {sortedClients.map((client) => {
            const rows = flattenTree({
              ...tree,
              roots: tree.roots.filter((r) => r.clientId === client.id),
            }).filter(({ node }) => visibleIds.has(node.id) && !hiddenByCollapse(node, tree.byId, collapsed));
            if (rows.length === 0 && (q || client.isInternal === false) && !canAddTopLevel) return null;
            if (rows.length === 0 && q) return null;
            return (
              <ClientGroup
                key={client.id}
                client={client}
                droppable={canAddTopLevel}
                onAdd={
                  canAddTopLevel
                    ? () => setDialog({ kind: "new", clientId: client.id, parentId: null })
                    : undefined
                }
              >
                {rows.length === 0 && <li className="tree-empty subtle">No projects for this client yet.</li>}
                {rows.map(({ node, depth }) => {
                  const t = totals.get(node.id) ?? zeroTotals();
                  const hasChildren = (tree.children.get(node.id) ?? []).length > 0;
                  const manage = canManageProject(actor, node.id, access);
                  return (
                    <ProjectRow
                      key={node.id}
                      project={node}
                      depth={depth}
                      totals={t}
                      hasChildren={hasChildren}
                      collapsed={collapsed.has(node.id)}
                      onToggle={() =>
                        setCollapsed((s) => {
                          const n = new Set(s);
                          if (n.has(node.id)) n.delete(node.id);
                          else n.add(node.id);
                          return n;
                        })
                      }
                      memberCount={members.filter((m) => m.projectId === node.id).length}
                      manage={manage}
                      onEdit={(tab) => setDialog({ kind: "edit", project: node, tab })}
                      onAddChild={() =>
                        setDialog({ kind: "new", clientId: node.clientId, parentId: node.id })
                      }
                      onMove={() => setDialog({ kind: "move", project: node })}
                      onArchive={async () => {
                        try {
                          await mutate(() =>
                            api.post(`/projects/${node.id}/${node.archivedAt ? "unarchive" : "archive"}`),
                          );
                          const item = Boolean(node.parentId);
                          toast.show(
                            node.archivedAt
                              ? `${item ? "Reopened" : "Restored"} “${node.name}”.`
                              : item
                                ? `Marked “${node.name}” done. Its hours are kept, and it can't take new ones.`
                                : `Archived “${node.name}”. Its time is kept.`,
                            {
                              kind: "success",
                            },
                          );
                        } catch (e) {
                          toast.error(errorMessage(e));
                        }
                      }}
                    />
                  );
                })}
              </ClientGroup>
            );
          })}
        </div>
      </DndContext>

      {dialog?.kind === "new" && (
        <ProjectDialog
          mode="new"
          clientId={dialog.clientId}
          parentId={dialog.parentId}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "edit" && (
        <ProjectDialog
          mode="edit"
          project={dialog.project}
          initialTab={dialog.tab}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "move" && (
        <MoveProjectDialog
          project={dialog.project}
          onClose={() => setDialog(null)}
          onMove={async (parentId, clientId) => {
            await move(dialog.project, parentId, clientId);
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}

function hiddenByCollapse(node: Project, byId: Map<string, Project>, collapsed: Set<string>): boolean {
  let cur = node.parentId ? byId.get(node.parentId) : undefined;
  while (cur) {
    if (collapsed.has(cur.id)) return true;
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return false;
}

function ClientGroup({
  client,
  children,
  droppable,
  onAdd,
}: {
  client: Client;
  children: React.ReactNode;
  droppable: boolean;
  onAdd?: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `client:${client.id}`, disabled: !droppable });
  return (
    <section className="card tree-card" aria-label={client.name}>
      <header ref={setNodeRef} className="tree-client" data-over={isOver || undefined}>
        <div className="row grow">
          <h2 style={{ fontSize: "var(--text-md)" }}>{client.name}</h2>
          {client.code && <Badge>{client.code}</Badge>}
          {client.isInternal && <Badge tone="info">Internal</Badge>}
          {client.archivedAt && <Badge>Archived</Badge>}
        </div>
        {onAdd && (
          <Button size="sm" variant="ghost" icon={<Plus />} onClick={onAdd}>
            Project
          </Button>
        )}
      </header>
      <ul className="tree-list" aria-label={`${client.name} projects`}>
        {children}
      </ul>
    </section>
  );
}

function ProjectRow({
  project,
  depth,
  totals,
  hasChildren,
  collapsed,
  onToggle,
  memberCount,
  manage,
  onEdit,
  onAddChild,
  onMove,
  onArchive,
}: {
  project: Project;
  depth: number;
  totals: Totals;
  hasChildren: boolean;
  collapsed: boolean;
  onToggle: () => void;
  memberCount: number;
  manage: boolean;
  onEdit: (tab?: Tab) => void;
  onAddChild: () => void;
  onMove: () => void;
  onArchive: () => void;
}) {
  const drag = useDraggable({ id: project.id, disabled: !manage });
  const drop = useDroppable({ id: `project:${project.id}`, disabled: !manage });
  const menuAnchor = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState(false);
  const budget = budgetStatus(project, totals);
  const ratio = budget.hoursRatio ?? 0;

  return (
    <li
      ref={drop.setNodeRef}
      className="tree-row"
      data-over={drop.isOver && !drag.isDragging ? true : undefined}
      data-dragging={drag.isDragging || undefined}
      data-archived={project.archivedAt ? true : undefined}
      style={{ paddingLeft: 8 + depth * 22 }}
    >
      {manage ? (
        <button
          ref={drag.setNodeRef}
          type="button"
          className="tree-handle"
          aria-label={`Drag ${project.name}`}
          {...drag.listeners}
          {...drag.attributes}
        >
          <GripVertical />
        </button>
      ) : (
        <span className="tree-handle" />
      )}
      {hasChildren ? (
        <button
          type="button"
          className="tree-toggle"
          onClick={onToggle}
          aria-label={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? <ChevronRight /> : <ChevronDown />}
        </button>
      ) : (
        <span className="tree-toggle" />
      )}
      <button type="button" className="tree-name" onClick={() => onEdit("details")}>
        <Dot color={project.color} />
        {depth === 0 && project.code && (
          <span className="mono" style={{ fontSize: 12, fontWeight: 600 }}>
            {project.code}
          </span>
        )}
        <span className="truncate">{project.name}</span>
        {depth > 0 && <span className="sr-only">(level {depth + 1})</span>}
        {depth > 0 && project.code && (
          <span className="subtle mono" style={{ fontSize: 12 }}>
            {project.code}
          </span>
        )}
      </button>
      <div className="tree-meta">
        {!project.parentId && !project.code && (
          <Badge tone="warning" title="Every project needs a code. Open it to add one.">
            Code missing
          </Badge>
        )}
        {project.visibility === "everyone" && <Badge tone="info">Everyone</Badge>}
        {project.kind && <Badge>{project.kind}</Badge>}
        {project.archivedAt && <Badge>{project.parentId ? "Done" : "Archived"}</Badge>}
        {memberCount > 0 && (
          <button
            type="button"
            className="tree-link"
            onClick={() => onEdit("team")}
            aria-label={`${memberCount} people`}
          >
            <UsersIcon /> {memberCount}
          </button>
        )}
      </div>
      <div className="tree-budget">
        {budget.level !== "none" ? (
          <>
            <Progress value={ratio} label={`Budget used for ${project.name}`} />
            <span className={`tnum tree-budget__label tree-budget__label--${budget.level}`}>
              {fmtHours(totals.seconds)}
              {project.budgetMinutes ? ` / ${Math.round(project.budgetMinutes / 60)} h` : ""}
            </span>
          </>
        ) : (
          <span className="tnum subtle tree-budget__label">
            {totals.seconds ? fmtHours(totals.seconds) : ""}
          </span>
        )}
      </div>
      <div className="tree-actions">
        {manage && (
          <>
            <Button
              ref={menuAnchor}
              size="sm"
              variant="ghost"
              iconOnly
              label={`Actions for ${project.name}`}
              icon={<MoreHorizontal />}
              onClick={() => setMenu((m) => !m)}
            />
            <Popover
              open={menu}
              onClose={() => setMenu(false)}
              anchor={menuAnchor}
              placement="bottom-end"
              role="menu"
              label="Project actions"
            >
              <Menu
                onClose={() => setMenu(false)}
                items={[
                  { label: "Edit", icon: <Pencil />, onSelect: () => onEdit("details") },
                  { label: "Add item under it", icon: <FolderPlus />, onSelect: onAddChild },
                  { label: "Items", icon: <ListTree />, onSelect: () => onEdit("items") },
                  { label: "People", icon: <UsersIcon />, onSelect: () => onEdit("team") },
                  { label: "Move to…", icon: <MoveRight />, onSelect: onMove },
                  "sep",
                  project.parentId
                    ? project.archivedAt
                      ? { label: "Reopen", icon: <RotateCcw />, onSelect: onArchive }
                      : { label: "Mark done", icon: <CheckCircle2 />, onSelect: onArchive }
                    : project.archivedAt
                      ? { label: "Restore", icon: <ArchiveRestore />, onSelect: onArchive }
                      : { label: "Archive", icon: <Archive />, onSelect: onArchive, danger: true },
                ]}
              />
            </Popover>
          </>
        )}
      </div>
    </li>
  );
}
