import type { Database } from "bun:sqlite";
import { type AccessContext, type Actor, canSeeRates, type User } from "@stint/shared";
import { getRow, listRows, TABLES } from "../db/tables.ts";

export function getUser(db: Database, id: string): User | null {
  return getRow(db, TABLES.users, id) as User | null;
}

export function findUserByEmail(db: Database, email: string) {
  return db
    .query<{ id: string; password_hash: string | null; active: number; deleted_at: number | null }, [string]>(
      "SELECT id, password_hash, active, deleted_at FROM users WHERE email = ?",
    )
    .get(email);
}

/** Removes fields the viewer may not see. */
export function shapeUser(u: User, viewer: Actor, ctx: AccessContext): User {
  return canSeeRates(viewer, u.id, ctx) ? u : { ...u, rate: null };
}

/** Users visible to `viewer`: everyone for admins/managers; members see themselves only. */
export function visibleUsers(db: Database, viewer: Actor, ctx: AccessContext): User[] {
  const all = listRows(db, TABLES.users, "deleted_at IS NULL ORDER BY name COLLATE NOCASE") as User[];
  const list = viewer.role === "member" ? all.filter((u) => u.id === viewer.id) : all;
  return list.map((u) => shapeUser(u, viewer, ctx));
}

/**
 * Makes this person's apps throw away their local copy and pull everything again. Needed when
 * what they may see changes in a way older rows don't reveal (role, project access, team).
 * Their line manager is reset too, because a manager sees their team's projects.
 */
export function bumpSyncEpoch(db: Database, userId: string, opts: { withManager?: boolean } = {}): void {
  db.query("UPDATE users SET sync_epoch = sync_epoch + 1 WHERE id = ?").run(userId);
  if (opts.withManager) {
    db.query(
      "UPDATE users SET sync_epoch = sync_epoch + 1 WHERE id = (SELECT manager_id FROM users WHERE id = ?)",
    ).run(userId);
  }
}

export function activeAdminCount(db: Database): number {
  return db
    .query<{ n: number }, []>(
      "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND deleted_at IS NULL",
    )
    .get()!.n;
}
