import type { Database } from "bun:sqlite";
import { defaultOrgSettings, type SetupInput, uuidv7 } from "@stint/shared";
import { hashPassword } from "../auth/passwords.ts";
import { insertRow, nextSeq, TABLES } from "../db/tables.ts";
import { audit } from "../lib/audit.ts";

export async function runSetup(
  db: Database,
  input: SetupInput,
  now: number,
  ip: string,
): Promise<{ adminId: string }> {
  const passwordHash = await hashPassword(input.admin.password);
  const adminId = uuidv7(now);
  db.transaction(() => {
    const settings = { ...defaultOrgSettings(), timezone: input.timezone };
    const seq = nextSeq(db);
    db.query(
      "INSERT INTO organization (id, name, settings, created_at, updated_at, server_seq) VALUES ('org', ?, ?, ?, ?, ?)",
    ).run(input.organizationName, JSON.stringify(settings), now, now, seq);

    insertRow(db, TABLES.users, {
      id: adminId,
      email: input.admin.email,
      name: input.admin.name,
      role: "admin",
      rate: null,
      color: "#1f5c4a",
      active: true,
      mustChangePassword: false,
      managerId: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    db.query("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, adminId);

    createInternalClient(db, now);
    audit(db, now, {
      actorId: adminId,
      action: "setup",
      entity: "organization",
      entityId: "org",
      after: { name: input.organizationName },
      ip,
    });
  })();
  return { adminId };
}

export function createInternalClient(db: Database, now: number): string {
  const clientId = uuidv7(now);
  insertRow(db, TABLES.clients, {
    id: clientId,
    name: "Internal",
    code: "INT",
    rate: null,
    isInternal: true,
    notes: "Built-in client for the firm's own work. Add projects here for admin, training, leave…",
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });
  return clientId;
}
