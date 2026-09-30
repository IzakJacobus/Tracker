import { Id, IsoDate, subtreeIds, type TimeEntry } from "@stint/shared";
import { Hono } from "hono";
import { z } from "zod";
import { requireRole } from "../auth/middleware.ts";
import type { AppContext } from "../context.ts";
import { listRows, TABLES, updateRow } from "../db/tables.ts";
import { actorOf, body, clientIp, type HonoEnv, query } from "../http.ts";
import { audit } from "../lib/audit.ts";
import { badRequest } from "../lib/errors.ts";
import { projectTree } from "../services/catalog.ts";
import { getOrgSettings } from "../services/org.ts";
import { isPeriodLocked, snapshotRate } from "../services/syncPush.ts";

const AuditQuery = z.object({
  entity: z.string().max(40).optional(),
  entityId: z.string().max(64).optional(),
  actorId: z.string().max(64).optional(),
  action: z.string().max(40).optional(),
  before: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

const RerateInput = z.object({
  from: IsoDate,
  to: IsoDate,
  projectId: Id.optional(),
  userId: Id.optional(),
  includeLocked: z.boolean().default(false),
  dryRun: z.boolean().default(true),
  reason: z.string().trim().max(500).default(""),
});

export function adminRoutes(ctx: AppContext) {
  const r = new Hono<HonoEnv>();
  r.use("*", requireRole("admin"));

  /** Audit log, newest first, keyset-paginated with `before` (an id). */
  r.get("/audit", (c) => {
    const q = query(c, AuditQuery);
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (q.entity) {
      where.push("a.entity = ?");
      params.push(q.entity);
    }
    if (q.entityId) {
      where.push("a.entity_id = ?");
      params.push(q.entityId);
    }
    if (q.actorId) {
      where.push("a.actor_id = ?");
      params.push(q.actorId);
    }
    if (q.action) {
      where.push("a.action = ?");
      params.push(q.action);
    }
    if (q.before) {
      where.push("a.id < ?");
      params.push(q.before);
    }
    const rows = ctx.db
      .query<Record<string, unknown>, (string | number)[]>(
        `SELECT a.*, u.name AS actor_name FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
         ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY a.id DESC LIMIT ${q.limit}`,
      )
      .all(...params)
      .map((a) => ({
        id: a.id,
        at: a.at,
        actorId: a.actor_id,
        actorName: a.actor_name,
        action: a.action,
        entity: a.entity,
        entityId: a.entity_id,
        before: a.before ? JSON.parse(String(a.before)) : null,
        after: a.after ? JSON.parse(String(a.after)) : null,
        reason: a.reason,
        ip: a.ip,
      }));
    return c.json({ rows, next: rows.length === q.limit ? rows[rows.length - 1]!.id : null });
  });

  /**
   * Deliberately re-price entries with today's rates. Rates are otherwise frozen
   * on each entry so later rate changes never rewrite history.
   */
  r.post("/rerate", async (c) => {
    const actor = actorOf(c);
    const input = await body(c, RerateInput);
    if (input.from > input.to) throw badRequest("The start date must be before the end date.");
    const settings = getOrgSettings(ctx.db);
    const where = ["deleted_at IS NULL", "duration_s IS NOT NULL", "entry_date BETWEEN ? AND ?"];
    const params: string[] = [input.from, input.to];
    if (input.userId) {
      where.push("user_id = ?");
      params.push(input.userId);
    }
    let entries = listRows(ctx.db, TABLES.timeEntries, where.join(" AND "), params) as TimeEntry[];
    if (input.projectId) {
      const ids = new Set(subtreeIds(projectTree(ctx.db), input.projectId));
      entries = entries.filter((e) => ids.has(e.projectId));
    }
    let skippedLocked = 0;
    const changes: { entry: TimeEntry; rate: number }[] = [];
    for (const e of entries) {
      if (!input.includeLocked && isPeriodLocked(ctx.db, e.userId, e.entryDate)) {
        skippedLocked++;
        continue;
      }
      const rate = snapshotRate(ctx.db, e, settings);
      if (rate !== e.rateSnapshot) changes.push({ entry: e, rate });
    }
    const amount = (list: { seconds: number; rate: number | null }[]) =>
      list.reduce((s, x) => s + Math.round((x.seconds * (x.rate ?? 0)) / 3600), 0);
    const summary = {
      matched: entries.length,
      changed: changes.length,
      skippedLocked,
      amountBefore: amount(
        changes.map((x) => ({ seconds: x.entry.durationS ?? 0, rate: x.entry.rateSnapshot })),
      ),
      amountAfter: amount(changes.map((x) => ({ seconds: x.entry.durationS ?? 0, rate: x.rate }))),
      dryRun: input.dryRun,
    };
    if (!input.dryRun && changes.length) {
      const now = ctx.now();
      ctx.db.transaction(() => {
        for (const ch of changes)
          updateRow(
            ctx.db,
            TABLES.timeEntries,
            ch.entry.id,
            { rateSnapshot: ch.rate, currency: settings.currency },
            now,
          );
        audit(ctx.db, now, {
          actorId: actor.id,
          action: "rerate",
          entity: "time_entry",
          entityId: null,
          before: {
            from: input.from,
            to: input.to,
            projectId: input.projectId,
            userId: input.userId,
            amount: summary.amountBefore,
          },
          after: {
            changed: changes.length,
            amount: summary.amountAfter,
            ids: changes.map((x) => x.entry.id),
          },
          reason: input.reason,
          ip: clientIp(c),
        });
      })();
    }
    return c.json(summary);
  });

  return r;
}
