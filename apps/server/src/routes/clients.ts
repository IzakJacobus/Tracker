import { type Client, CreateClientInput, UpdateClientInput, uuidv7 } from "@stint/shared";
import { Hono } from "hono";
import { requireAuth, requireRole } from "../auth/middleware.ts";
import type { AppContext } from "../context.ts";
import { insertRow, listRows, TABLES, updateRow } from "../db/tables.ts";
import { actorOf, body, clientIp, type HonoEnv } from "../http.ts";
import { audit } from "../lib/audit.ts";
import { badRequest, notFound } from "../lib/errors.ts";
import { accessContext } from "../services/access.ts";
import { allProjects, getClient } from "../services/catalog.ts";
import { projectVisible } from "../services/shape.ts";

export function clientRoutes(ctx: AppContext) {
  const r = new Hono<HonoEnv>();

  r.get("/", requireAuth, (c) => {
    const actor = actorOf(c);
    const all = listRows(
      ctx.db,
      TABLES.clients,
      "deleted_at IS NULL ORDER BY is_internal DESC, name COLLATE NOCASE",
    ) as Client[];
    if (actor.role === "admin" || actor.role === "manager") return c.json(all.map((x) => x));
    const access = accessContext(ctx.db, actor);
    const visibleClientIds = new Set(
      allProjects(ctx.db)
        .filter((p) => projectVisible(p, actor, access))
        .map((p) => p.clientId),
    );
    return c.json(all.filter((x) => visibleClientIds.has(x.id)).map((x) => x));
  });

  r.post("/", requireRole("admin"), async (c) => {
    const actor = actorOf(c);
    const input = await body(c, CreateClientInput);
    const now = ctx.now();
    const row = insertRow(ctx.db, TABLES.clients, {
      id: input.id ?? uuidv7(now),
      name: input.name,
      code: input.code ?? null,
      isInternal: false,
      notes: input.notes ?? "",
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    audit(ctx.db, now, {
      actorId: actor.id,
      action: "create",
      entity: "client",
      entityId: row.id as string,
      after: row,
      ip: clientIp(c),
    });
    return c.json(row, 201);
  });

  r.patch("/:id", requireRole("admin"), async (c) => {
    const actor = actorOf(c);
    const id = c.req.param("id");
    const before = getClient(ctx.db, id);
    if (!before || before.deletedAt) throw notFound("Client");
    const input = await body(c, UpdateClientInput);
    const now = ctx.now();
    const after = updateRow(ctx.db, TABLES.clients, id, input, now);
    audit(ctx.db, now, {
      actorId: actor.id,
      action: "update",
      entity: "client",
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
    r.post(`/:id/${path}`, requireRole("admin"), (c) => {
      const actor = actorOf(c);
      const id = c.req.param("id");
      const before = getClient(ctx.db, id);
      if (!before || before.deletedAt) throw notFound("Client");
      if (before.isInternal && archive) throw badRequest("The built-in Internal client can't be archived.");
      const now = ctx.now();
      const after = updateRow(ctx.db, TABLES.clients, id, { archivedAt: archive ? now : null }, now);
      audit(ctx.db, now, {
        actorId: actor.id,
        action: archive ? "archive" : "unarchive",
        entity: "client",
        entityId: id,
        ip: clientIp(c),
      });
      return c.json(after);
    });
  }

  return r;
}
