import { CreateUserInput, ResetPasswordInput, UpdateUserInput, uuidv7 } from "@stint/shared";
import { Hono } from "hono";
import { requireAuth, requireRole } from "../auth/middleware.ts";
import { hashPassword } from "../auth/passwords.ts";
import { destroyUserSessions } from "../auth/sessions.ts";
import type { AppContext } from "../context.ts";
import { insertRow, TABLES, updateRow } from "../db/tables.ts";
import { actorOf, body, clientIp, type HonoEnv } from "../http.ts";
import { audit } from "../lib/audit.ts";
import { badRequest, conflict, notFound } from "../lib/errors.ts";
import { accessContext, invalidateAccessCache } from "../services/access.ts";
import {
  activeAdminCount,
  bumpSyncEpoch,
  findUserByEmail,
  getUser,
  shapeUser,
  visibleUsers,
} from "../services/users.ts";

export function userRoutes(ctx: AppContext) {
  const r = new Hono<HonoEnv>();

  r.get("/", requireAuth, (c) => {
    const actor = actorOf(c);
    return c.json(visibleUsers(ctx.db, actor, accessContext(ctx.db, actor)));
  });

  r.post("/", requireRole("admin"), async (c) => {
    const actor = actorOf(c);
    const input = await body(c, CreateUserInput);
    if (findUserByEmail(ctx.db, input.email))
      throw conflict("Someone with that email address already exists.");
    if (input.managerId && !getUser(ctx.db, input.managerId)) throw badRequest("Manager not found.");
    const now = ctx.now();
    const id = input.id ?? uuidv7(now);
    const hash = await hashPassword(input.password);
    const user = ctx.db.transaction(() => {
      const u = insertRow(ctx.db, TABLES.users, {
        id,
        email: input.email,
        name: input.name,
        role: input.role,
        rate: input.rate,
        weeklyCapacityMinutes: input.weeklyCapacityMinutes,
        color: input.color,
        active: true,
        mustChangePassword: true,
        managerId: input.managerId,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
      ctx.db.query("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, id);
      audit(ctx.db, now, {
        actorId: actor.id,
        action: "create",
        entity: "user",
        entityId: id,
        after: u,
        ip: clientIp(c),
      });
      return u;
    })();
    invalidateAccessCache(ctx.db);
    return c.json(user, 201);
  });

  r.patch("/:id", requireRole("admin"), async (c) => {
    const actor = actorOf(c);
    const id = c.req.param("id");
    const input = await body(c, UpdateUserInput);
    const before = getUser(ctx.db, id);
    if (!before || before.deletedAt) throw notFound("User");
    if (input.email && input.email !== before.email) {
      const other = findUserByEmail(ctx.db, input.email);
      if (other && other.id !== id) throw conflict("Someone with that email address already exists.");
    }
    const losingAdmin =
      before.role === "admin" &&
      before.active &&
      ((input.role && input.role !== "admin") || input.active === false);
    if (losingAdmin && activeAdminCount(ctx.db) <= 1) {
      throw badRequest("Stint needs at least one active admin. Make someone else an admin first.");
    }
    if (input.managerId === id) throw badRequest("People cannot be their own manager.");
    const now = ctx.now();
    const after = ctx.db.transaction(() => {
      const u = updateRow(ctx.db, TABLES.users, id, input, now);
      if (input.role && input.role !== before.role) bumpSyncEpoch(ctx.db, id);
      if (input.active === false) destroyUserSessions(ctx.db, id);
      audit(ctx.db, now, {
        actorId: actor.id,
        action: "update",
        entity: "user",
        entityId: id,
        before,
        after: u,
        ip: clientIp(c),
      });
      return u;
    })();
    invalidateAccessCache(ctx.db);
    return c.json(shapeUser(after as never, actor, accessContext(ctx.db, actor)));
  });

  r.post("/:id/reset-password", requireRole("admin"), async (c) => {
    const actor = actorOf(c);
    const id = c.req.param("id");
    const input = await body(c, ResetPasswordInput);
    if (!getUser(ctx.db, id)) throw notFound("User");
    const hash = await hashPassword(input.password);
    ctx.db
      .query("UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?")
      .run(hash, ctx.now(), id);
    destroyUserSessions(ctx.db, id);
    audit(ctx.db, ctx.now(), {
      actorId: actor.id,
      action: "password_reset",
      entity: "user",
      entityId: id,
      ip: clientIp(c),
    });
    return c.json({ ok: true });
  });

  return r;
}
