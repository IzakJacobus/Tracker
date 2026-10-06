import type { Database } from "bun:sqlite";
import { buildTree, type Client, type Project, type Tree } from "@stint/shared";
import { getRow, listRows, TABLES } from "../db/tables.ts";

export function getClient(db: Database, id: string): Client | null {
  return getRow(db, TABLES.clients, id) as Client | null;
}
export function getProject(db: Database, id: string): Project | null {
  return getRow(db, TABLES.projects, id) as Project | null;
}

export function allProjects(db: Database): Project[] {
  return listRows(db, TABLES.projects, "deleted_at IS NULL") as Project[];
}

export function projectTree(db: Database): Tree<Project> {
  return buildTree(allProjects(db), (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

/** A project is effectively archived if it or any ancestor, or its client, is archived. */
export function isEffectivelyArchived(db: Database, projectId: string): boolean {
  const tree = projectTree(db);
  let cur = tree.byId.get(projectId);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    if (cur.archivedAt) return true;
    seen.add(cur.id);
    cur = cur.parentId ? tree.byId.get(cur.parentId) : undefined;
  }
  const p = tree.byId.get(projectId);
  const client = p ? getClient(db, p.clientId) : null;
  return Boolean(client?.archivedAt);
}

export const PROJECT_COLORS = [
  "#1f5c4a",
  "#2f8a6c",
  "#b86e12",
  "#6d5bd0",
  "#2463a6",
  "#b3361f",
  "#0f766e",
  "#8b5a2b",
  "#a21caf",
  "#475569",
  "#ca8a04",
  "#be185d",
];

/** Ancestors of a project, nearest first (excluding the project itself). */
export function ancestorsNearestFirst(db: Database, projectId: string): Project[] {
  const out: Project[] = [];
  const seen = new Set<string>([projectId]);
  let cur = getProject(db, projectId)?.parentId ?? null;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const p = getProject(db, cur);
    if (!p) break;
    out.push(p);
    cur = p.parentId;
  }
  return out;
}
