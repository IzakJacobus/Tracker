import {
  canApproveTimesheet,
  canSubmitTimesheet,
  canUnlockTimesheet,
  canViewUserTime,
  IsoDate,
  localDate,
  periodFor,
  type Timesheet,
  uuidv7,
} from "@stint/shared";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../auth/middleware.ts";
import type { AppContext } from "../context.ts";
import { getRow, insertRow, listRows, TABLES, updateRow } from "../db/tables.ts";
import { actorOf, body, clientIp, type HonoEnv } from "../http.ts";
import { audit } from "../lib/audit.ts";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.ts";
import { accessContext } from "../services/access.ts";
import { getOrgSettings } from "../services/org.ts";
import { getUser } from "../services/users.ts";

const SubmitInput = z.object({ date: IsoDate, userId: z.string().optional() });
const DecideInput = z.object({ comment: z.string().trim().max(2000).default("") });
const RejectInput = z.object({ comment: z.string().trim().min(1, "Say what needs to change.").max(2000) });
const UnlockInput = z.object({
  reason: z.string().trim().min(3, "Give a reason — it is kept in the audit log.").max(2000),
});

/**
 * Timesheet workflow: draft → submitted → approved (locked), or → rejected → submitted again.
 * Admins can unlock submitted or approved periods, with a reason in the audit log.
 * While a period is submitted or approved, sync refuses every change to its entries.
 */
export function timesheetRoutes(ctx: AppContext) {
  const r = new Hono<HonoEnv>();
  r.use("*", requireAuth);

  const get = (id: string) => {
    const t = getRow(ctx.db, TABLES.timesheets, id) as Timesheet | null;
    if (!t || t.deletedAt) throw notFound("Timesheet");
    return t;
  };

  r.get("/", (c) => {
    const actor = actorOf(c);
    const access = accessContext(ctx.db, actor);
    const status = c.req.query("status");
    const rows = (
      listRows(ctx.db, TABLES.timesheets, "deleted_at IS NULL ORDER BY period_start DESC") as Timesheet[]
    ).filter((t) => canViewUserTime(actor, t.userId, access) && (!status || t.status === status));
    return c.json(rows);
  });

  r.post("/submit", async (c) => {
    const actor = actorOf(c);
    const input = await body(c, SubmitInput);
    const userId = input.userId ?? actor.id;
    if (!canSubmitTimesheet(actor, userId)) throw forbidden("You can only submit your own timesheet.");
    if (!getUser(ctx.db, userId)) throw notFound("User");
    const settings = getOrgSettings(ctx.db);
    const period = periodFor(input.date, settings.approvalPeriod, settings.weekStart);
    const now = ctx.now();
    if (period.start > localDate(now, settings.timezone))
      throw badRequest("You can't submit a period that hasn't started yet.");
    const running = ctx.db
      .query<{ n: number }, [string, string, string]>(
        "SELECT COUNT(*) AS n FROM time_entries WHERE user_id = ? AND duration_s IS NULL AND deleted_at IS NULL AND entry_date BETWEEN ? AND ?",
      )
      .get(userId, period.start, period.end)!.n;
    if (running) throw conflict("A timer is still running in this period. Stop it first, then submit.");

    const existing = ctx.db
      .query<{ id: string }, [string, string]>(
        "SELECT id FROM timesheets WHERE user_id = ? AND period_start = ?",
      )
      .get(userId, period.start);
    const before = existing ? get(existing.id) : null;
    if (before && (before.status === "submitted" || before.status === "approved")) {
      throw conflict(
        before.status === "approved"
          ? "This period is already approved."
          : "This period is already submitted.",
      );
    }
    const sheet = ctx.db.transaction(() => {
      const row = before
        ? updateRow(
            ctx.db,
            TABLES.timesheets,
            before.id,
            { status: "submitted", submittedAt: now, decidedBy: null, decidedAt: null, deletedAt: null },
            now,
          )
        : insertRow(ctx.db, TABLES.timesheets, {
            id: uuidv7(now),
            userId,
            periodStart: period.start,
            periodEnd: period.end,
            status: "submitted",
            submittedAt: now,
            decidedBy: null,
            decidedAt: null,
            comment: "",
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          });
      audit(ctx.db, now, {
        actorId: actor.id,
        action: "submit",
        entity: "timesheet",
        entityId: row.id as string,
        before,
        after: row,
        ip: clientIp(c),
      });
      return row;
    })();
    return c.json(sheet);
  });

  r.post("/:id/withdraw", (c) => {
    const actor = actorOf(c);
    const t = get(c.req.param("id"));
    if (!canSubmitTimesheet(actor, t.userId)) throw forbidden();
    if (t.status !== "submitted") throw conflict("Only a submitted timesheet can be withdrawn.");
    const now = ctx.now();
    const after = updateRow(ctx.db, TABLES.timesheets, t.id, { status: "draft", submittedAt: null }, now);
    audit(ctx.db, now, {
      actorId: actor.id,
      action: "withdraw",
      entity: "timesheet",
      entityId: t.id,
      before: t,
      after,
      ip: clientIp(c),
    });
    return c.json(after);
  });

  const decide = (kind: "approve" | "reject") =>
    r.post(`/:id/${kind}`, async (c) => {
      const actor = actorOf(c);
      const t = get(c.req.param("id"));
      if (!canApproveTimesheet(actor, t.userId, accessContext(ctx.db, actor))) {
        throw forbidden(
          actor.id === t.userId
            ? "Someone else must approve your timesheet."
            : "You can only approve your own team's timesheets.",
        );
      }
      if (t.status !== "submitted")
        throw conflict("Only a submitted timesheet can be approved or sent back.");
      const input = kind === "approve" ? await body(c, DecideInput) : await body(c, RejectInput);
      const now = ctx.now();
      const after = updateRow(
        ctx.db,
        TABLES.timesheets,
        t.id,
        {
          status: kind === "approve" ? "approved" : "rejected",
          decidedBy: actor.id,
          decidedAt: now,
          comment: input.comment,
        },
        now,
      );
      audit(ctx.db, now, {
        actorId: actor.id,
        action: kind,
        entity: "timesheet",
        entityId: t.id,
        before: t,
        after,
        reason: input.comment,
        ip: clientIp(c),
      });
      return c.json(after);
    });
  decide("approve");
  decide("reject");

  r.post("/:id/unlock", async (c) => {
    const actor = actorOf(c);
    if (!canUnlockTimesheet(actor)) throw forbidden("Only admins can unlock a timesheet.");
    const t = get(c.req.param("id"));
    if (t.status !== "approved" && t.status !== "submitted") throw conflict("This timesheet isn't locked.");
    const input = await body(c, UnlockInput);
    const now = ctx.now();
    const after = updateRow(
      ctx.db,
      TABLES.timesheets,
      t.id,
      { status: "draft", decidedBy: actor.id, decidedAt: now, comment: `Unlocked: ${input.reason}` },
      now,
    );
    audit(ctx.db, now, {
      actorId: actor.id,
      action: "unlock",
      entity: "timesheet",
      entityId: t.id,
      before: t,
      after,
      reason: input.reason,
      ip: clientIp(c),
    });
    return c.json(after);
  });

  return r;
}
