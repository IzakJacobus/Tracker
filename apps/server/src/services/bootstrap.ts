import type { Database } from "bun:sqlite";
import { defaultOrgSettings, type SetupInput, uuidv7 } from "@stint/shared";
import { hashPassword } from "../auth/passwords.ts";
import { insertRow, nextSeq, TABLES } from "../db/tables.ts";
import { audit } from "../lib/audit.ts";

/** Internal work every consulting firm has. Visible to everyone, non-billable. */
export const INTERNAL_PROJECTS: { name: string; color: string; tasks: string[] }[] = [
  { name: "Administration", color: "#64748b", tasks: ["Timesheets & admin", "Meetings", "IT & equipment"] },
  { name: "Business development", color: "#b7791f", tasks: ["Proposals", "Client meetings", "Marketing"] },
  { name: "Training", color: "#6d5bd0", tasks: ["Courses", "Conferences", "CPD"] },
  { name: "Research & development", color: "#0f766e", tasks: [] },
  {
    name: "Leave",
    color: "#9ca3af",
    tasks: ["Annual leave", "Sick leave", "Family responsibility", "Public holiday"],
  },
];

export async function runSetup(
  db: Database,
  input: SetupInput,
  now: number,
  ip: string,
): Promise<{ adminId: string }> {
  const passwordHash = await hashPassword(input.admin.password);
  const adminId = uuidv7(now);
  db.transaction(() => {
    const settings = { ...defaultOrgSettings(), currency: input.currency, timezone: input.timezone };
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
      weeklyCapacityMinutes: 2400,
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
    notes: "Built-in client for the firm's own, non-billable work.",
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });
  INTERNAL_PROJECTS.forEach((p, i) => {
    const projectId = uuidv7(now);
    insertRow(db, TABLES.projects, {
      id: projectId,
      clientId,
      parentId: null,
      name: p.name,
      code: null,
      kind: null,
      color: p.color,
      billableDefault: false,
      rate: null,
      budgetMinutes: null,
      budgetAmount: null,
      visibility: "everyone",
      notes: "",
      sortOrder: i,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    p.tasks.forEach((t, j) => {
      insertRow(db, TABLES.projects, {
        id: uuidv7(now),
        clientId,
        parentId: projectId,
        name: t,
        code: null,
        kind: "Task",
        color: p.color,
        billableDefault: false,
        rate: null,
        budgetMinutes: null,
        budgetAmount: null,
        visibility: "everyone",
        notes: "",
        sortOrder: j,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
    });
  });
  return clientId;
}
