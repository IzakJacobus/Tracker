import type { Role } from "./schemas.ts";

/**
 * Role-based access policy. These pure functions are the single definition of
 * "who may do what". The server ENFORCES them on every request; the client uses
 * the same functions only to decide which buttons to show.
 */

export interface Actor {
  id: string;
  role: Role;
}

export interface AccessContext {
  /** project id → parent project id */
  projectParent: ReadonlyMap<string, string | null>;
  /** project id → visibility */
  projectVisibility: ReadonlyMap<string, "members" | "everyone">;
  /** the actor's own project memberships: project id → role on that project */
  memberships: ReadonlyMap<string, "member" | "manager">;
  /** user id → their line manager's user id */
  userManager: ReadonlyMap<string, string | null>;
  /**
   * Managers only: projects that people they line-manage are members of. Lets a manager see
   * the projects their team's time is on (to read it, not to track on them).
   */
  teamProjects?: ReadonlySet<string>;
}

export const isAdmin = (a: Actor) => a.role === "admin";
export const isManagerOrAdmin = (a: Actor) => a.role === "admin" || a.role === "manager";

/** The project and all of its ancestors, nearest first. Safe against cycles. */
export function projectLineage(projectId: string, ctx: Pick<AccessContext, "projectParent">): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let cur: string | null | undefined = projectId;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    out.push(cur);
    cur = ctx.projectParent.get(cur);
  }
  return out;
}

/** Effective role on a project: memberships are inherited down the tree. */
export function projectRoleFor(
  actor: Actor,
  projectId: string,
  ctx: AccessContext,
): "manager" | "member" | null {
  if (isAdmin(actor)) return "manager";
  let found: "manager" | "member" | null = null;
  for (const id of projectLineage(projectId, ctx)) {
    const r = ctx.memberships.get(id);
    if (r === "manager") return actor.role === "manager" ? "manager" : "member";
    if (r === "member") found = "member";
  }
  return found;
}

export function isProjectOpenToEveryone(projectId: string, ctx: AccessContext): boolean {
  return projectLineage(projectId, ctx).some((id) => ctx.projectVisibility.get(id) === "everyone");
}

export function canTrackOnProject(actor: Actor, projectId: string, ctx: AccessContext): boolean {
  if (!ctx.projectParent.has(projectId)) return false;
  if (isAdmin(actor)) return true;
  return isProjectOpenToEveryone(projectId, ctx) || projectRoleFor(actor, projectId, ctx) !== null;
}

export function canViewProject(actor: Actor, projectId: string, ctx: AccessContext): boolean {
  if (canTrackOnProject(actor, projectId, ctx)) return true;
  if (actor.role !== "manager" || !ctx.teamProjects?.size || !ctx.projectParent.has(projectId)) return false;
  return projectLineage(projectId, ctx).some((id) => ctx.teamProjects!.has(id));
}

export function canManageProject(actor: Actor, projectId: string, ctx: AccessContext): boolean {
  if (isAdmin(actor)) return true;
  if (actor.role !== "manager") return false;
  return projectRoleFor(actor, projectId, ctx) === "manager";
}

/** Top-level projects: admins only. Sub-projects: anyone who manages the parent. */
export function canCreateProject(actor: Actor, parentId: string | null, ctx: AccessContext): boolean {
  if (isAdmin(actor)) return true;
  return parentId !== null && canManageProject(actor, parentId, ctx);
}

export const canManageClients = isAdmin;
export const canManageUsers = isAdmin;
export const canManageOrganization = isAdmin;
export const canViewAuditLog = isAdmin;
export const canManageBackups = isAdmin;
export const canUnlockTimesheet = isAdmin;
export const canManageTags = isManagerOrAdmin;
export const canCreateTag = (_a: Actor) => true;

export function isTeamMember(
  managerId: string,
  userId: string,
  ctx: Pick<AccessContext, "userManager">,
): boolean {
  return ctx.userManager.get(userId) === managerId;
}

/** May the actor see all of `userId`'s time (their monthly timesheet)? */
export function canViewUserTime(actor: Actor, userId: string, ctx: AccessContext): boolean {
  if (actor.id === userId || isAdmin(actor)) return true;
  return actor.role === "manager" && isTeamMember(actor.id, userId, ctx);
}

export function canViewEntry(
  actor: Actor,
  entry: { userId: string; projectId: string },
  ctx: AccessContext,
): boolean {
  if (canViewUserTime(actor, entry.userId, ctx)) return true;
  return actor.role === "manager" && canManageProject(actor, entry.projectId, ctx);
}

/** Editing entries: the owner (subject to locks) or an admin. */
export function canEditEntry(actor: Actor, entry: { userId: string }): boolean {
  return actor.id === entry.userId || isAdmin(actor);
}

export function canApproveTimesheet(actor: Actor, userId: string, ctx: AccessContext): boolean {
  if (isAdmin(actor)) return true;
  if (actor.role !== "manager" || actor.id === userId) return false;
  return isTeamMember(actor.id, userId, ctx);
}

export function canSubmitTimesheet(actor: Actor, userId: string): boolean {
  return actor.id === userId || isAdmin(actor);
}

export function emptyAccessContext(): AccessContext {
  return {
    projectParent: new Map(),
    projectVisibility: new Map(),
    memberships: new Map(),
    userManager: new Map(),
  };
}
