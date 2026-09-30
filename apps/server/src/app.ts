import { Hono } from "hono";
import { requireCsrfHeader, sessionMiddleware } from "./auth/middleware.ts";
import type { AppContext } from "./context.ts";
import type { HonoEnv } from "./http.ts";
import { ApiError } from "./lib/errors.ts";
import { authRoutes } from "./routes/auth.ts";
import { orgRoutes } from "./routes/org.ts";
import { pairingRoutes } from "./routes/pairing.ts";
import { systemRoutes } from "./routes/system.ts";
import { userRoutes } from "./routes/users.ts";

export function createApp(ctx: AppContext) {
  const app = new Hono<HonoEnv>();

  app.use("*", async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Frame-Options", "DENY");
    if (c.req.path.startsWith("/api/")) c.header("Cache-Control", "no-store");
  });

  const api = new Hono<HonoEnv>();
  api.use("*", requireCsrfHeader);
  api.use("*", sessionMiddleware(ctx));
  api.route("/", systemRoutes(ctx));
  api.route("/auth", authRoutes(ctx));
  api.route("/org", orgRoutes(ctx));
  api.route("/users", userRoutes(ctx));
  api.route("/pairing", pairingRoutes(ctx));
  api.all("*", (c) => c.json({ error: { code: "not_found", message: "Unknown API route." } }, 404));

  app.route("/api", api);

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json({ error: { code: err.code, message: err.message, details: err.details } }, err.status);
    }
    ctx.log.error(`Unhandled error on ${c.req.method} ${c.req.path}`, err);
    return c.json({ error: { code: "internal", message: "Something went wrong on the server." } }, 500);
  });

  return app;
}

export type App = ReturnType<typeof createApp>;
