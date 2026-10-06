import type { AccessContext, Project, ProjectMember } from "@stint/shared";
import type { Me } from "../lib/types.ts";

/**
 * The same permission context the server builds, computed from the local copy.
 * Used only to decide what to show — the server always re-checks.
 */
export function accessFromLocal(projects: Project[], members: ProjectMember[], me: Me): AccessContext {
  const memberships = new Map<string, "member" | "manager">();
  for (const m of members) if (m.userId === me.user.id && !m.deletedAt) memberships.set(m.projectId, m.role);
  return {
    projectParent: new Map(projects.map((p) => [p.id, p.parentId])),
    projectVisibility: new Map(projects.map((p) => [p.id, p.visibility])),
    memberships,
    userManager: new Map(),
  };
}
