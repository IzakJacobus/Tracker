import { existsSync } from "node:fs";
import { join } from "node:path";
import { Id } from "@stint/shared";
import { Hono } from "hono";
import { z } from "zod";
import { requireRole } from "../auth/middleware.ts";
import type { AppContext } from "../context.ts";
import { actorOf, body, clientIp, type HonoEnv, query } from "../http.ts";
import { audit } from "../lib/audit.ts";
import { ApiError, conflict, notFound } from "../lib/errors.ts";
import {
  backupFolder,
  browseFolders,
  lastBackup,
  listBackups,
  restoreBackup,
  runBackup,
} from "../services/backup.ts";
import { healthReport } from "../services/health.ts";
import { importEntries } from "../services/importer.ts";
import { checkForUpdate, storedUpdateInfo } from "../services/updates.ts";

const AuditQuery = z.object({
  entity: z.string().max(40).optional(),
  entityId: z.string().max(64).optional(),
  actorId: z.string().max(64).optional(),
  action: z.string().max(40).optional(),
  before: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

const BackupName = z.object({ name: z.string().regex(/^stint-[\w-]+\.db$/, "Pick a backup from the list.") });
const RunBackupInput = z.object({ folder: z.string().trim().min(1).max(1000).optional() });
const FsQuery = z.object({ path: z.string().max(1000).optional() });
const ImportInput = z.object({
  csv: z.string().min(1, "Choose a CSV file.").max(20_000_000, "The file is too big (20 MB at most)."),
  dryRun: z.boolean().default(true),
  createMissing: z.boolean().default(true),
  people: z.record(z.string().max(200), Id).default({}),
});
const MakePrivateInput = z.object({ interfaceAlias: z.string().trim().min(1).max(256) });

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

  /** CSV import (Toggl Track detailed export, Stint export, or simple columns). Dry run by default. */
  r.post("/import", async (c) => {
    const actor = actorOf(c);
    const input = await body(c, ImportInput);
    return c.json(importEntries(ctx.db, { ...input, actorId: actor.id, ip: clientIp(c), now: ctx.now() }));
  });

  /* ---------------------------- Backups ---------------------------- */

  r.get("/backups", (c) => {
    const folder = backupFolder(ctx);
    return c.json({
      folder,
      last: lastBackup(ctx.db),
      files: listBackups(folder).map(({ name, sizeBytes, createdAt }) => ({ name, sizeBytes, createdAt })),
      safetyCopies: listBackups(join(ctx.config.dataDir, "restore-safety")).map(
        ({ name, sizeBytes, createdAt }) => ({
          name,
          sizeBytes,
          createdAt,
        }),
      ),
    });
  });

  /** Runs a backup now. With `folder`, it is a test write to a folder the admin is about to choose. */
  r.post("/backups/run", async (c) => {
    const actor = actorOf(c);
    const input = await body(c, RunBackupInput);
    // With a folder it's a test write to a folder the admin is about to choose.
    const result = runBackup(ctx, input.folder ? "folder-test" : "manual", input.folder);
    audit(ctx.db, ctx.now(), {
      actorId: actor.id,
      action: "backup",
      entity: "server",
      entityId: null,
      before: null,
      after: { ok: result.ok, path: result.path, error: result.error },
      ip: clientIp(c),
    });
    if (!result.ok) throw new ApiError(422, "backup_failed", result.error ?? "The backup failed.");
    return c.json(result);
  });

  r.post("/backups/restore", async (c) => {
    const actor = actorOf(c);
    const input = await body(c, BackupName);
    const folders = [backupFolder(ctx), join(ctx.config.dataDir, "restore-safety")];
    const file = folders.map((f) => join(f, input.name)).find((p) => existsSync(p));
    if (!file) throw notFound("Backup");
    const result = restoreBackup(ctx, file);
    if (!result.ok) throw conflict(result.error ?? "Restore failed.");
    // Logged into the restored database so the history shows who restored what.
    audit(ctx.db, ctx.now(), {
      actorId: actor.id,
      action: "backup_restore",
      entity: "server",
      entityId: null,
      before: null,
      after: { file: input.name, safetyCopy: result.safetyCopy },
      ip: clientIp(c),
    });
    if (result.restartRequired) ctx.services.requestRestart?.();
    return c.json(result);
  });

  /* ----------------------------- Health ----------------------------- */

  r.get("/health", (c) => c.json(healthReport(ctx)));

  r.post("/health/refresh", async (c) => {
    await ctx.services.refreshPlatform?.();
    return c.json(healthReport(ctx));
  });

  r.post("/network/private", async (c) => {
    const actor = actorOf(c);
    const input = await body(c, MakePrivateInput);
    const known = ctx.runtime.platform?.networks.some((n) => n.interfaceAlias === input.interfaceAlias);
    if (!known || !ctx.services.makeNetworkPrivate) throw notFound("Network");
    const ok = await ctx.services.makeNetworkPrivate(input.interfaceAlias);
    audit(ctx.db, ctx.now(), {
      actorId: actor.id,
      action: "update",
      entity: "network",
      entityId: input.interfaceAlias,
      before: { category: "Public" },
      after: { category: ok ? "Private" : "Public" },
      ip: clientIp(c),
    });
    await ctx.services.refreshPlatform?.();
    if (!ok)
      throw conflict(
        "Windows didn't allow the change. Open Settings → Network on the server PC and choose Private.",
      );
    return c.json(healthReport(ctx));
  });

  r.get("/updates", (c) => c.json(storedUpdateInfo(ctx)));
  r.post("/updates/check", async (c) => c.json(await checkForUpdate(ctx)));

  /** Lists folders on the server PC so an admin can pick a backup location from any browser. */
  r.get("/fs", (c) => {
    const q = query(c, FsQuery);
    return c.json(browseFolders(q.path ?? null, ctx.config.dataDir));
  });

  return r;
}
