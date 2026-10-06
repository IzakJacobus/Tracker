import {
  type AccessContext,
  type Actor,
  canViewEntry,
  canViewProject,
  canViewUserTime,
  type Favorite,
  type Project,
  type ProjectMember,
  type TimeEntry,
  type Timesheet,
} from "@stint/shared";

/** Who may see which rows. Every row that leaves the server is checked here. */

export function projectVisible(p: Pick<Project, "id">, actor: Actor, access: AccessContext): boolean {
  return canViewProject(actor, p.id, access);
}

export function memberVisible(m: ProjectMember, actor: Actor, access: AccessContext): boolean {
  if (actor.role === "admin") return true;
  if (m.userId === actor.id) return true;
  return actor.role === "manager" && canViewProject(actor, m.projectId, access);
}

export function entryVisible(e: TimeEntry, actor: Actor, access: AccessContext): boolean {
  return canViewEntry(actor, e, access);
}

export function timesheetVisible(t: Timesheet, actor: Actor, access: AccessContext): boolean {
  return canViewUserTime(actor, t.userId, access);
}

export function favoriteVisible(f: Favorite, actor: Actor): boolean {
  return f.userId === actor.id;
}
