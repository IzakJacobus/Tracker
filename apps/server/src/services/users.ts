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

export function bumpSyncEpoch(db: Database, userId: string): void {
  db.query("UPDATE users SET sync_epoch = sync_epoch + 1 WHERE id = ?").run(userId);
}

export function activeAdminCount(db: Database): number {
  return db
    .query<{ n: number }, []>(
      "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND deleted_at IS NULL",
    )
    .get()!.n;
}
