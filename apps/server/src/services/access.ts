import type { Database } from "bun:sqlite";
import type { AccessContext, Actor } from "@stint/shared";
import { currentSeq } from "../db/tables.ts";
import { getOrgSettings } from "./org.ts";

interface Snapshot {
  seq: number;
  projectParent: Map<string, string | null>;
  projectVisibility: Map<string, "members" | "everyone">;
  memberships: Map<string, Map<string, "member" | "manager">>;
  userManager: Map<string, string | null>;
  membersSeeOwnRates: boolean;
}

const cache = new WeakMap<Database, Snapshot>();

function load(db: Database): Snapshot {
  const seq = currentSeq(db);
  const hit = cache.get(db);
  if (hit && hit.seq === seq) return hit;
  const projectParent = new Map<string, string | null>();
  const projectVisibility = new Map<string, "members" | "everyone">();
  for (const p of db
    .query<{ id: string; parent_id: string | null; visibility: "members" | "everyone" }, []>(
      "SELECT id, parent_id, visibility FROM projects WHERE deleted_at IS NULL",
    )
    .all()) {
    projectParent.set(p.id, p.parent_id);
    projectVisibility.set(p.id, p.visibility);
  }
  const memberships = new Map<string, Map<string, "member" | "manager">>();
  for (const m of db
    .query<{ user_id: string; project_id: string; role: "member" | "manager" }, []>(
      "SELECT user_id, project_id, role FROM project_members WHERE deleted_at IS NULL",
    )
    .all()) {
    let mm = memberships.get(m.user_id);
    if (!mm) {
      mm = new Map();
      memberships.set(m.user_id, mm);
    }
    mm.set(m.project_id, m.role);
  }
  const userManager = new Map<string, string | null>();
  for (const u of db
    .query<{ id: string; manager_id: string | null }, []>("SELECT id, manager_id FROM users")
    .all()) {
    userManager.set(u.id, u.manager_id);
  }
  const snap: Snapshot = {
    seq,
    projectParent,
    projectVisibility,
    memberships,
    userManager,
    membersSeeOwnRates: getOrgSettings(db).membersSeeOwnRates,
  };
  cache.set(db, snap);
  return snap;
}

/** Builds the permission context for `actor`. Cached until any synced row changes. */
export function accessContext(db: Database, actor: Actor): AccessContext {
  const s = load(db);
  let teamProjects: Set<string> | undefined;
  if (actor.role === "manager") {
    teamProjects = new Set();
    for (const [userId, managerId] of s.userManager) {
      if (managerId !== actor.id) continue;
      for (const projectId of s.memberships.get(userId)?.keys() ?? []) teamProjects.add(projectId);
    }
  }
  return {
    teamProjects,
    projectParent: s.projectParent,
    projectVisibility: s.projectVisibility,
    memberships: s.memberships.get(actor.id) ?? new Map(),
    userManager: s.userManager,
    membersSeeOwnRates: s.membersSeeOwnRates,
  };
}

export function invalidateAccessCache(db: Database): void {
  cache.delete(db);
}
