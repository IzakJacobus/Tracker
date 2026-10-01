import { LogoDataUrl, Name, OrgSettings, OrgSettingsPatch } from "@stint/shared";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/middleware.ts";
import type { AppContext } from "../context.ts";
import { nextSeq } from "../db/tables.ts";
import { actorOf, body, clientIp, type HonoEnv } from "../http.ts";
import { audit } from "../lib/audit.ts";
import { notFound, validationError } from "../lib/errors.ts";
import { invalidateAccessCache } from "../services/access.ts";
import { getOrganization } from "../services/org.ts";

const OrgPatch = z.object({ name: Name.optional(), settings: OrgSettingsPatch.optional() });

export function orgRoutes(ctx: AppContext) {
  const r = new Hono<HonoEnv>();

  r.get("/", requireAuth, (c) => {
    const org = getOrganization(ctx.db);
    if (!org) throw notFound("Organisation");
    return c.json(org);
  });

  r.patch("/", requireRole("admin"), async (c) => {
    const actor = actorOf(c);
    const input = await body(c, OrgPatch);
    const before = getOrganization(ctx.db);
    if (!before) throw notFound("Organisation");
    const merged = OrgSettings.safeParse({ ...before.settings, ...(input.settings ?? {}) });
    if (!merged.success) throw validationError(merged.error);
    const now = ctx.now();
    ctx.db
      .query(
        "UPDATE organization SET name = ?, settings = ?, updated_at = ?, server_seq = ? WHERE id = 'org'",
      )
      .run(input.name ?? before.name, JSON.stringify(merged.data), now, nextSeq(ctx.db));
    invalidateAccessCache(ctx.db);
    const after = getOrganization(ctx.db)!;
    audit(ctx.db, now, {
      actorId: actor.id,
      action: "settings",
      entity: "organization",
      entityId: "org",
      before: { name: before.name, settings: before.settings },
      after: { name: after.name, settings: after.settings },
      ip: clientIp(c),
    });
    // Sleep prevention and remote access take effect without a restart.
    void ctx.services.refreshPlatform?.();
    return c.json(after);
  });

  r.put("/logo", requireRole("admin"), async (c) => {
    const actor = actorOf(c);
    const input = await body(c, z.object({ logo: LogoDataUrl.nullable() }));
    const now = ctx.now();
    ctx.db
      .query("UPDATE organization SET logo = ?, updated_at = ?, server_seq = ? WHERE id = 'org'")
      .run(input.logo, now, nextSeq(ctx.db));
    audit(ctx.db, now, {
      actorId: actor.id,
      action: "settings",
      entity: "organization",
      entityId: "org",
      after: { logo: input.logo ? "updated" : "removed" },
      ip: clientIp(c),
    });
    return c.json(getOrganization(ctx.db));
  });

  return r;
}
