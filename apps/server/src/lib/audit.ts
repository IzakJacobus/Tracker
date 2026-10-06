import type { Database } from "bun:sqlite";

export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "restore"
  | "archive"
  | "unarchive"
  | "submit"
  | "approve"
  | "reject"
  | "unlock"
  | "withdraw"
  | "import"
  | "login"
  | "login_failed"
  | "logout"
  | "password_change"
  | "password_reset"
  | "setup"
  | "backup"
  | "backup_restore"
  | "settings";

export interface AuditRecord {
  actorId: string | null;
  action: AuditAction;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string;
  ip?: string;
}

export function audit(db: Database, at: number, r: AuditRecord): void {
  db.query(
    "INSERT INTO audit_log (at, actor_id, action, entity, entity_id, before, after, reason, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    at,
    r.actorId,
    r.action,
    r.entity,
    r.entityId ?? null,
    r.before === undefined ? null : JSON.stringify(r.before),
    r.after === undefined ? null : JSON.stringify(r.after),
    r.reason ?? "",
    r.ip ?? "",
  );
}
