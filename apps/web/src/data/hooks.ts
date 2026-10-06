import {
  buildTree,
  type Client,
  type Project,
  type ProjectMember,
  type Tag,
  type Tree,
  type User,
} from "@stint/shared";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import { useData } from "./DataProvider.tsx";

const EMPTY: never[] = [];

export function useClients(): Client[] {
  const { db } = useData();
  return useLiveQuery(() => db.clients.toArray(), [db]) ?? EMPTY;
}

export function useProjects(): Project[] {
  const { db } = useData();
  return useLiveQuery(() => db.projects.toArray(), [db]) ?? EMPTY;
}

export function useTags(): Tag[] {
  const { db } = useData();
  return useLiveQuery(() => db.tags.toArray(), [db]) ?? EMPTY;
}

export function useUsers(): User[] {
  const { db } = useData();
  return useLiveQuery(() => db.users.toArray(), [db]) ?? EMPTY;
}

export function useMembers(): ProjectMember[] {
  const { db } = useData();
  return useLiveQuery(() => db.projectMembers.toArray(), [db]) ?? EMPTY;
}

export function useProjectTree(projects: Project[]): Tree<Project> {
  return useMemo(
    () => buildTree(projects, (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [projects],
  );
}

/** Everything a picker needs to show "Client › Project › Sub-project" labels. */
export interface ProjectOption {
  project: Project;
  client: Client | undefined;
  path: string[];
  label: string;
  archived: boolean;
}

export function useProjectOptions(): ProjectOption[] {
  const projects = useProjects();
  const clients = useClients();
  const tree = useProjectTree(projects);
  return useMemo(() => {
    const clientById = new Map(clients.map((c) => [c.id, c]));
    const out: ProjectOption[] = [];
    for (const p of projects) {
      const path: string[] = [];
      let archived = Boolean(p.archivedAt);
      let cur: Project | undefined = p;
      const seen = new Set<string>();
      while (cur && !seen.has(cur.id)) {
        seen.add(cur.id);
        path.unshift(cur.name);
        if (cur.archivedAt) archived = true;
        cur = cur.parentId ? tree.byId.get(cur.parentId) : undefined;
      }
      const client = clientById.get(p.clientId);
      if (client?.archivedAt) archived = true;
      out.push({ project: p, client, path, label: path.join(" › "), archived });
    }
    return out.sort(
      (a, b) =>
        Number(b.client?.isInternal ?? false) - Number(a.client?.isInternal ?? false) ||
        (a.client?.name ?? "").localeCompare(b.client?.name ?? "") ||
        a.label.localeCompare(b.label),
    );
  }, [projects, clients, tree]);
}
