import type { Role } from "@stint/shared";
import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { AppContext } from "../context.ts";
import type { AuthedUser, HonoEnv } from "../http.ts";
import { ApiError, forbidden, unauthorized } from "../lib/errors.ts";
import { SESSION_COOKIE, validateSession } from "./sessions.ts";

export function readToken(authHeader: string | undefined, cookie: string | undefined): string | null {
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7).trim() || null;
  return cookie ?? null;
}

/** Resolves the session (cookie or bearer token) into c.var.user / c.var.actor. */
export function sessionMiddleware(ctx: AppContext) {
  return createMiddleware<HonoEnv>(async (c, next) => {
    c.set("user", null);
    c.set("actor", null);
    c.set("sessionToken", null);
    const token = readToken(c.req.header("authorization"), getCookie(c, SESSION_COOKIE));
    if (token) {
      const s = validateSession(ctx.db, token, ctx.now());
      if (s) {
        const u = ctx.db
          .query<
            {
              id: string;
              email: string;
              name: string;
              role: Role;
              active: number;
              must_change_password: number;
            },
            [string]
          >(
            "SELECT id, email, name, role, active, must_change_password FROM users WHERE id = ? AND deleted_at IS NULL",
          )
          .get(s.user_id);
        if (u?.active) {
          const user: AuthedUser = {
            id: u.id,
            email: u.email,
            name: u.name,
            role: u.role,
            active: true,
            mustChangePassword: u.must_change_password === 1,
          };
          c.set("user", user);
          c.set("actor", { id: u.id, role: u.role });
          c.set("sessionToken", token);
        }
      }
    }
    await next();
  });
}

export const requireAuth = createMiddleware<HonoEnv>(async (c, next) => {
  if (!c.get("user")) throw unauthorized();
  await next();
});

export function requireRole(...roles: Role[]) {
  return createMiddleware<HonoEnv>(async (c, next) => {
    const u = c.get("user");
    if (!u) throw unauthorized();
    if (!roles.includes(u.role)) throw forbidden();
    await next();
  });
}

/**
 * CSRF defence in depth (cookies are already SameSite=Strict): every state-changing
 * request must carry a custom header, which a cross-site form cannot set.
 */
export const requireCsrfHeader = createMiddleware<HonoEnv>(async (c, next) => {
  const m = c.req.method;
  if (m !== "GET" && m !== "HEAD" && m !== "OPTIONS" && c.req.header("x-stint-request") !== "1") {
    throw new ApiError(403, "csrf", "Missing X-Stint-Request header.");
  }
  await next();
});
