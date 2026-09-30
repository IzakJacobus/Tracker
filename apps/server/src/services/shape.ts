import {
  type AccessContext,
  type Actor,
  type Client,
  canSeeRates,
  canViewEntry,
  canViewProject,
  canViewUserTime,
  type Favorite,
  isManagerOrAdmin,
  type Project,
  type ProjectMember,
  type Task,
  type TimeEntry,
  type Timesheet,
} from "@stint/shared";

/**
 * Per-role shaping: everything that leaves the server passes through here, so
 * members never receive rates or money unless the organisation allows it.
 */
const seesMoney = (actor: Actor) => isManagerOrAdmin(actor);

export function shapeClient(c: Client, actor: Actor): Client {
  return seesMoney(actor) ? c : { ...c, rate: null };
}

export function shapeProject(p: Project, actor: Actor): Project {
  return seesMoney(actor) ? p : { ...p, rate: null, budgetAmount: null };
}

export function shapeTask(t: Task, actor: Actor): Task {
  return seesMoney(actor) ? t : { ...t, rate: null };
}

export function shapeMember(m: ProjectMember, actor: Actor): ProjectMember {
  return seesMoney(actor) ? m : { ...m, rate: null };
}

export function shapeEntry(e: TimeEntry, actor: Actor, access: AccessContext): TimeEntry {
  return canSeeRates(actor, e.userId, access) ? e : { ...e, rateSnapshot: null };
}

/* Visibility ------------------------------------------------------- */

export function projectVisible(p: Pick<Project, "id">, actor: Actor, access: AccessContext): boolean {
  return canViewProject(actor, p.id, access);
}

export function taskVisible(t: Pick<Task, "projectId">, actor: Actor, access: AccessContext): boolean {
  return canViewProject(actor, t.projectId, access);
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
