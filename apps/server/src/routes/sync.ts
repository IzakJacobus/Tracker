import { formatHlc } from "@stint/shared";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../auth/middleware.ts";
import type { AppContext } from "../context.ts";
import { actorOf, body, clientIp, type HonoEnv, query } from "../http.ts";
import { pull } from "../services/syncPull.ts";
import { PushBody, push } from "../services/syncPush.ts";

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

  r.post("/push", async (c) => {
    const input = await body(c, PushBody);
    const now = ctx.now();
    const results = push(ctx.db, actorOf(c), input.changes, now, clientIp(c));
    return c.json({ results, serverHlc: formatHlc({ ms: now, counter: 0, node: "server" }) });
  });

  return r;
}
