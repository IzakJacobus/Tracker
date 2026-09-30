import { ChangePasswordInput, LoginInput } from "@stint/shared";
import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { requireAuth } from "../auth/middleware.ts";
import { dummyHash, hashPassword, verifyPassword } from "../auth/passwords.ts";
import {
  createSession,
  destroySession,
  destroyUserSessions,
  SESSION_COOKIE,
  SESSION_TTL_MS,
} from "../auth/sessions.ts";
import type { AppContext } from "../context.ts";
import { actorOf, body, clientIp, type HonoEnv } from "../http.ts";
import { audit } from "../lib/audit.ts";
import { ApiError, badRequest } from "../lib/errors.ts";
import { accessContext } from "../services/access.ts";
import { getOrganization } from "../services/org.ts";
import { findUserByEmail, getUser, shapeUser } from "../services/users.ts";

export function authRoutes(ctx: AppContext) {
  const r = new Hono<HonoEnv>();

  r.post("/login", async (c) => {
    const input = await body(c, LoginInput);
    const ip = clientIp(c);
    const wait = ctx.limiter.retryAfter(input.email, ip);
    if (wait > 0) {
      const minutes = Math.ceil(wait / 60_000);
      c.header("Retry-After", String(Math.ceil(wait / 1000)));
      throw new ApiError(
        429,
        "too_many_attempts",
        `Too many sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      );
    }
    const found = findUserByEmail(ctx.db, input.email);
    let ok = false;
    if (found) {
      ok = await verifyPassword(input.password, found.password_hash);
    } else {
      await verifyPassword(input.password, await dummyHash()); // equalise timing
    }
    if (!found || !ok || !found.active || found.deleted_at !== null) {
      ctx.limiter.fail(input.email, ip);
      audit(ctx.db, ctx.now(), {
        actorId: found?.id ?? null,
        action: "login_failed",
        entity: "session",
        after: { email: input.email },
        ip,
      });
      throw new ApiError(401, "invalid_credentials", "That email and password do not match.");
    }
    ctx.limiter.succeed(input.email, ip);
    const kind = c.req.header("x-stint-client") === "desktop" ? "desktop" : "browser";
    const token = createSession(ctx.db, found.id, kind, ctx.now(), {
      userAgent: c.req.header("user-agent"),
      ip,
    });
    audit(ctx.db, ctx.now(), { actorId: found.id, action: "login", entity: "session", ip, after: { kind } });
    if (kind === "browser") {
      setCookie(c, SESSION_COOKIE, token, {
        httpOnly: true,
        secure: true,
        sameSite: "Strict",
        path: "/",
        maxAge: SESSION_TTL_MS / 1000,
      });
      return c.json({ ok: true });
    }
    // The desktop app keeps the token inside its Rust process and sends it as a bearer token.
    return c.json({ ok: true, token });
  });

  r.post("/logout", (c) => {
    const token = c.get("sessionToken");
    if (token) destroySession(ctx.db, token);
    deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true });
    const u = c.get("user");
    if (u) audit(ctx.db, ctx.now(), { actorId: u.id, action: "logout", entity: "session", ip: clientIp(c) });
    return c.json({ ok: true });
  });

  r.get("/me", requireAuth, (c) => {
    const actor = actorOf(c);
    const user = getUser(ctx.db, actor.id)!;
    const org = getOrganization(ctx.db);
    const access = accessContext(ctx.db, actor);
    return c.json({
      user: shapeUser(user, actor, access),
      organization: org,
      permissions: {
        seeRates: actor.role !== "member" || (org?.settings.membersSeeOwnRates ?? false),
      },
    });
  });

  r.post("/password", requireAuth, async (c) => {
    const actor = actorOf(c);
    const input = await body(c, ChangePasswordInput);
    const row = ctx.db
      .query<{ password_hash: string | null }, [string]>("SELECT password_hash FROM users WHERE id = ?")
      .get(actor.id);
    if (!(await verifyPassword(input.currentPassword, row?.password_hash ?? null))) {
      throw badRequest("Your current password is not correct.");
    }
    const hash = await hashPassword(input.newPassword);
    ctx.db
      .query("UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?")
      .run(hash, ctx.now(), actor.id);
    destroyUserSessions(ctx.db, actor.id, c.get("sessionToken") ?? undefined);
    audit(ctx.db, ctx.now(), {
      actorId: actor.id,
      action: "password_change",
      entity: "user",
      entityId: actor.id,
      ip: clientIp(c),
    });
    return c.json({ ok: true });
  });

  return r;
}
