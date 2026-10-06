import { CreateTagInput, canManageTags, type Tag, UpdateTagInput, uuidv7 } from "@stint/shared";
import { Hono } from "hono";
import { requireAuth } from "../auth/middleware.ts";
import type { AppContext } from "../context.ts";
import { getRow, insertRow, listRows, TABLES, updateRow } from "../db/tables.ts";
import { actorOf, body, clientIp, type HonoEnv } from "../http.ts";
import { audit } from "../lib/audit.ts";
import { conflict, forbidden, notFound } from "../lib/errors.ts";

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
