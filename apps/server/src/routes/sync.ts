import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../auth/middleware.ts";
import type { AppContext } from "../context.ts";
import { actorOf, type HonoEnv, query } from "../http.ts";
import { pull } from "../services/syncPull.ts";

const PullQuery = z.object({
  since: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(2000).default(500),
});

export function syncRoutes(ctx: AppContext) {
  const r = new Hono<HonoEnv>();
  r.use("*", requireAuth);

  r.get("/pull", (c) => {
    const q = query(c, PullQuery);
    return c.json(pull(ctx.db, actorOf(c), q.since, q.limit, ctx.now()));
  });

  return r;
}
