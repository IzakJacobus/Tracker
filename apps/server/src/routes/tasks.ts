import {
  CreateTagInput,
  CreateTaskInput,
  canManageProject,
  canManageTags,
  type Tag,
  type Task,
  UpdateTagInput,
  UpdateTaskInput,
  uuidv7,
} from "@stint/shared";
import { Hono } from "hono";
import { requireAuth } from "../auth/middleware.ts";
import type { AppContext } from "../context.ts";
import { getRow, insertRow, listRows, TABLES, updateRow } from "../db/tables.ts";
import { actorOf, body, clientIp, type HonoEnv } from "../http.ts";
import { audit } from "../lib/audit.ts";
import { conflict, forbidden, notFound } from "../lib/errors.ts";
import { accessContext } from "../services/access.ts";
import { getProject, getTask } from "../services/catalog.ts";
import { shapeTask, taskVisible } from "../services/shape.ts";

export function taskRoutes(ctx: AppContext) {
  const r = new Hono<HonoEnv>();
  r.use("*", requireAuth);

  r.get("/", (c) => {
    const actor = actorOf(c);
    const access = accessContext(ctx.db, actor);
    const projectId = c.req.query("projectId");
    const rows = (
      projectId
        ? listRows(ctx.db, TABLES.tasks, "project_id = ? AND deleted_at IS NULL ORDER BY sort_order", [
            projectId,
          ])
        : listRows(ctx.db, TABLES.tasks, "deleted_at IS NULL ORDER BY sort_order")
    ) as Task[];
    return c.json(rows.filter((t) => taskVisible(t, actor, access)).map((t) => shapeTask(t, actor)));
  });

  r.post("/", async (c) => {
    const actor = actorOf(c);
    const input = await body(c, CreateTaskInput);
    const project = getProject(ctx.db, input.projectId);
    if (!project || project.deletedAt) throw notFound("Project");
    if (!canManageProject(actor, project.id, accessContext(ctx.db, actor))) throw forbidden();
    const now = ctx.now();
    const count = ctx.db
      .query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM tasks WHERE project_id = ?")
      .get(project.id)!.n;
    const row = insertRow(ctx.db, TABLES.tasks, {
      id: input.id ?? uuidv7(now),
      projectId: project.id,
      name: input.name,
      rate: input.rate ?? null,
      billable: input.billable ?? null,
      sortOrder: count,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    audit(ctx.db, now, {
      actorId: actor.id,
      action: "create",
      entity: "task",
      entityId: row.id as string,
      after: row,
      ip: clientIp(c),
    });
    return c.json(shapeTask(row as Task, actor), 201);
  });

  r.patch("/:id", async (c) => {
    const actor = actorOf(c);
    const id = c.req.param("id");
    const before = getTask(ctx.db, id);
    if (!before || before.deletedAt) throw notFound("Task");
    if (!canManageProject(actor, before.projectId, accessContext(ctx.db, actor))) throw forbidden();
    const input = await body(c, UpdateTaskInput);
    const now = ctx.now();
    const after = updateRow(ctx.db, TABLES.tasks, id, input, now);
    audit(ctx.db, now, {
      actorId: actor.id,
      action: "update",
      entity: "task",
      entityId: id,
      before,
      after,
      ip: clientIp(c),
    });
    return c.json(shapeTask(after as Task, actor));
  });

  for (const [path, archive] of [
    ["archive", true],
    ["unarchive", false],
  ] as const) {
    r.post(`/:id/${path}`, (c) => {
      const actor = actorOf(c);
      const id = c.req.param("id");
      const before = getTask(ctx.db, id);
      if (!before || before.deletedAt) throw notFound("Task");
      if (!canManageProject(actor, before.projectId, accessContext(ctx.db, actor))) throw forbidden();
      const now = ctx.now();
      const after = updateRow(ctx.db, TABLES.tasks, id, { archivedAt: archive ? now : null }, now);
      audit(ctx.db, now, {
        actorId: actor.id,
        action: archive ? "archive" : "unarchive",
        entity: "task",
        entityId: id,
        ip: clientIp(c),
      });
      return c.json(shapeTask(after as Task, actor));
    });
  }
  return r;
}

export function tagRoutes(ctx: AppContext) {
  const r = new Hono<HonoEnv>();
  r.use("*", requireAuth);

  r.get("/", (c) => c.json(listRows(ctx.db, TABLES.tags, "deleted_at IS NULL ORDER BY name COLLATE NOCASE")));

  r.post("/", async (c) => {
    const actor = actorOf(c);
    const input = await body(c, CreateTagInput);
    const dup = ctx.db
      .query<{ id: string }, [string]>(
        "SELECT id FROM tags WHERE name = ? COLLATE NOCASE AND deleted_at IS NULL",
      )
      .get(input.name);
    if (dup) throw conflict("A tag with that name already exists.", { id: dup.id });
    const now = ctx.now();
    const row = insertRow(ctx.db, TABLES.tags, {
      id: input.id ?? uuidv7(now),
      name: input.name,
      color: input.color ?? "#6b7280",
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    audit(ctx.db, now, {
      actorId: actor.id,
      action: "create",
      entity: "tag",
      entityId: row.id as string,
      after: row,
      ip: clientIp(c),
    });
    return c.json(row, 201);
  });

  r.patch("/:id", async (c) => {
    const actor = actorOf(c);
    if (!canManageTags(actor)) throw forbidden();
    const id = c.req.param("id");
    const before = getRow(ctx.db, TABLES.tags, id) as Tag | null;
    if (!before || before.deletedAt) throw notFound("Tag");
    const input = await body(c, UpdateTagInput);
    const now = ctx.now();
    const after = updateRow(ctx.db, TABLES.tags, id, input, now);
    audit(ctx.db, now, {
      actorId: actor.id,
      action: "update",
      entity: "tag",
      entityId: id,
      before,
      after,
      ip: clientIp(c),
    });
    return c.json(after);
  });

  for (const [path, archive] of [
    ["archive", true],
    ["unarchive", false],
  ] as const) {
    r.post(`/:id/${path}`, (c) => {
      const actor = actorOf(c);
      if (!canManageTags(actor)) throw forbidden();
      const id = c.req.param("id");
      const before = getRow(ctx.db, TABLES.tags, id);
      if (!before) throw notFound("Tag");
      const now = ctx.now();
      const after = updateRow(ctx.db, TABLES.tags, id, { archivedAt: archive ? now : null }, now);
      audit(ctx.db, now, {
        actorId: actor.id,
        action: archive ? "archive" : "unarchive",
        entity: "tag",
        entityId: id,
        ip: clientIp(c),
      });
      return c.json(after);
    });
  }
  return r;
}
