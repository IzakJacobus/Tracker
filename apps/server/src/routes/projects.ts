import {
  CreateProjectInput,
  canCreateProject,
  canManageProject,
  MoveProjectInput,
  type Project,
  type ProjectMember,
  SetMemberInput,
  subtreeIds,
  UpdateProjectInput,
  uuidv7,
  wouldCreateCycle,
} from "@stint/shared";
import { Hono } from "hono";
import { requireAuth } from "../auth/middleware.ts";
import type { AppContext } from "../context.ts";
import { insertRow, listRows, TABLES, updateRow } from "../db/tables.ts";
import { actorOf, body, clientIp, type HonoEnv } from "../http.ts";
import { audit } from "../lib/audit.ts";
import { badRequest, forbidden, notFound } from "../lib/errors.ts";
import { accessContext, invalidateAccessCache } from "../services/access.ts";
import { allProjects, getClient, getProject, PROJECT_COLORS, projectTree } from "../services/catalog.ts";
import { memberVisible, projectVisible } from "../services/shape.ts";
import { bumpGlobalSyncEpoch, bumpSyncEpoch, getUser } from "../services/users.ts";

export function projectRoutes(ctx: AppContext) {
  const r = new Hono<HonoEnv>();
  r.use("*", requireAuth);

  r.get("/", (c) => {
    const actor = actorOf(c);
    const access = accessContext(ctx.db, actor);
    return c.json(
      allProjects(ctx.db)
        .filter((p) => projectVisible(p, actor, access))
        .map((p) => p),
    );
  });

  r.post("/", async (c) => {
    const actor = actorOf(c);
    const input = await body(c, CreateProjectInput);
    const access = accessContext(ctx.db, actor);
    const parentId = input.parentId ?? null;
    if (!canCreateProject(actor, parentId, access)) throw forbidden("You can't create a project here.");
    let clientId = input.clientId;
    if (parentId) {
      const parent = getProject(ctx.db, parentId);
      if (!parent || parent.deletedAt) throw notFound("Parent project");
      if (clientId && clientId !== parent.clientId)
        throw badRequest("A sub-project must belong to the same client as its parent.");
      clientId = parent.clientId;
    }
    if (!clientId) throw badRequest("Choose a client for the project.");
    const client = getClient(ctx.db, clientId);
    if (!client || client.deletedAt) throw notFound("Client");
    const now = ctx.now();
    const siblings = allProjects(ctx.db).filter((p) => p.parentId === parentId && p.clientId === clientId);
    const parent = parentId ? getProject(ctx.db, parentId) : null;
    const row = insertRow(ctx.db, TABLES.projects, {
      id: input.id ?? uuidv7(now),
      clientId,
      parentId,
      name: input.name,
      code: input.code ?? null,
      kind: input.kind?.trim() || null,
      color:
        input.color ?? parent?.color ?? PROJECT_COLORS[allProjects(ctx.db).length % PROJECT_COLORS.length],
      budgetMinutes: input.budgetMinutes ?? null,
      visibility: input.visibility ?? (client.isInternal ? "everyone" : "members"),
      notes: input.notes ?? "",
      sortOrder: siblings.reduce((m, s) => Math.max(m, s.sortOrder), -1) + 1,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    audit(ctx.db, now, {
      actorId: actor.id,
      action: "create",
      entity: "project",
      entityId: row.id as string,
      after: row,
      ip: clientIp(c),
    });
    invalidateAccessCache(ctx.db);
    return c.json(row as Project, 201);
  });

  r.patch("/:id", async (c) => {
    const actor = actorOf(c);
    const id = c.req.param("id");
    const before = getProject(ctx.db, id);
    if (!before || before.deletedAt) throw notFound("Project");
    if (!canManageProject(actor, id, accessContext(ctx.db, actor))) throw forbidden();
    const input = await body(c, UpdateProjectInput);
    const now = ctx.now();
    const after = updateRow(ctx.db, TABLES.projects, id, input, now);
    // Items underneath didn't change, so incremental sync wouldn't deliver (or retract) them.
    if (input.visibility !== undefined && input.visibility !== before.visibility) bumpGlobalSyncEpoch(ctx.db);
    audit(ctx.db, now, {
      actorId: actor.id,
      action: "update",
      entity: "project",
      entityId: id,
      before,
      after,
      ip: clientIp(c),
    });
    invalidateAccessCache(ctx.db);
    return c.json(after as Project);
  });

  /** Drag-and-drop re-parenting / reordering. */
  r.post("/:id/move", async (c) => {
    const actor = actorOf(c);
    const id = c.req.param("id");
    const before = getProject(ctx.db, id);
    if (!before || before.deletedAt) throw notFound("Project");
    const input = await body(c, MoveProjectInput);
    const access = accessContext(ctx.db, actor);
    if (!canManageProject(actor, id, access)) throw forbidden();
    if (!canCreateProject(actor, input.parentId, access)) throw forbidden("You can't move a project there.");
    const tree = projectTree(ctx.db);
    if (wouldCreateCycle(tree, id, input.parentId))
      throw badRequest("A project can't be moved inside itself.");
    let clientId = before.clientId;
    if (input.parentId) {
      const parent = getProject(ctx.db, input.parentId);
      if (!parent || parent.deletedAt) throw notFound("Parent project");
      clientId = parent.clientId;
    } else if (input.clientId) {
      clientId = input.clientId;
    }
    if (clientId !== before.clientId) {
      if (actor.role !== "admin") throw forbidden("Only admins can move projects to another client.");
      const client = getClient(ctx.db, clientId);
      if (!client || client.deletedAt) throw notFound("Client");
    }
    const now = ctx.now();
    const moved = ctx.db.transaction(() => {
      const after = updateRow(
        ctx.db,
        TABLES.projects,
        id,
        {
          parentId: input.parentId,
          clientId,
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        },
        now,
      );
      // The whole subtree follows its root to the new client.
      if (clientId !== before.clientId) {
        for (const d of subtreeIds(tree, id)) {
          if (d !== id) updateRow(ctx.db, TABLES.projects, d, { clientId }, now);
        }
      }
      // A new parent or client changes who inherits access to the subtree's older rows.
      if (input.parentId !== before.parentId || clientId !== before.clientId) bumpGlobalSyncEpoch(ctx.db);
      audit(ctx.db, now, {
        actorId: actor.id,
        action: "update",
        entity: "project",
        entityId: id,
        before: { parentId: before.parentId, clientId: before.clientId, sortOrder: before.sortOrder },
        after: { parentId: input.parentId, clientId, sortOrder: input.sortOrder ?? before.sortOrder },
        reason: "move",
        ip: clientIp(c),
      });
      return after;
    })();
    invalidateAccessCache(ctx.db);
    return c.json(moved as Project);
  });

  for (const [path, archive] of [
    ["archive", true],
    ["unarchive", false],
  ] as const) {
    r.post(`/:id/${path}`, (c) => {
      const actor = actorOf(c);
      const id = c.req.param("id");
      const before = getProject(ctx.db, id);
      if (!before || before.deletedAt) throw notFound("Project");
      if (!canManageProject(actor, id, accessContext(ctx.db, actor))) throw forbidden();
      const now = ctx.now();
      const after = updateRow(ctx.db, TABLES.projects, id, { archivedAt: archive ? now : null }, now);
      audit(ctx.db, now, {
        actorId: actor.id,
        action: archive ? "archive" : "unarchive",
        entity: "project",
        entityId: id,
        ip: clientIp(c),
      });
      return c.json(after as Project);
    });
  }

  /* Members -------------------------------------------------------- */

  r.get("/:id/members", (c) => {
    const actor = actorOf(c);
    const id = c.req.param("id");
    const access = accessContext(ctx.db, actor);
    const rows = listRows(ctx.db, TABLES.projectMembers, "project_id = ? AND deleted_at IS NULL", [
      id,
    ]) as ProjectMember[];
    return c.json(rows.filter((m) => memberVisible(m, actor, access)).map((m) => m));
  });

  r.put("/:id/members/:userId", async (c) => {
    const actor = actorOf(c);
    const projectId = c.req.param("id");
    const userId = c.req.param("userId");
    const project = getProject(ctx.db, projectId);
    if (!project || project.deletedAt) throw notFound("Project");
    if (!canManageProject(actor, projectId, accessContext(ctx.db, actor))) throw forbidden();
    const user = getUser(ctx.db, userId);
    if (!user || user.deletedAt) throw notFound("User");
    const input = await body(c, SetMemberInput);
    if (input.role === "manager" && user.role === "member") {
      throw badRequest(`${user.name} is a member. Change their role to Manager in Team first.`);
    }
    const now = ctx.now();
    const existing = ctx.db
      .query<{ id: string }, [string, string]>(
        "SELECT id FROM project_members WHERE project_id = ? AND user_id = ?",
      )
      .get(projectId, userId);
    const row = ctx.db.transaction(() => {
      const out = existing
        ? updateRow(ctx.db, TABLES.projectMembers, existing.id, { role: input.role, deletedAt: null }, now)
        : insertRow(ctx.db, TABLES.projectMembers, {
            id: uuidv7(now),
            projectId,
            userId,
            role: input.role,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          });
      bumpSyncEpoch(ctx.db, userId, { withManager: true });
      audit(ctx.db, now, {
        actorId: actor.id,
        action: existing ? "update" : "create",
        entity: "project_member",
        entityId: out.id as string,
        after: out,
        ip: clientIp(c),
      });
      return out;
    })();
    invalidateAccessCache(ctx.db);
    return c.json(row as ProjectMember);
  });

  r.delete("/:id/members/:userId", (c) => {
    const actor = actorOf(c);
    const projectId = c.req.param("id");
    const userId = c.req.param("userId");
    if (!canManageProject(actor, projectId, accessContext(ctx.db, actor))) throw forbidden();
    const existing = ctx.db
      .query<{ id: string }, [string, string]>(
        "SELECT id FROM project_members WHERE project_id = ? AND user_id = ? AND deleted_at IS NULL",
      )
      .get(projectId, userId);
    if (!existing) throw notFound("Membership");
    const now = ctx.now();
    ctx.db.transaction(() => {
      updateRow(ctx.db, TABLES.projectMembers, existing.id, { deletedAt: now }, now);
      bumpSyncEpoch(ctx.db, userId, { withManager: true });
      audit(ctx.db, now, {
        actorId: actor.id,
        action: "delete",
        entity: "project_member",
        entityId: existing.id,
        ip: clientIp(c),
      });
    })();
    invalidateAccessCache(ctx.db);
    return c.json({ ok: true });
  });

  return r;
}
