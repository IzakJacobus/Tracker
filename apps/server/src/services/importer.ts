import type { Database } from "bun:sqlite";
import {
  type Client,
  type ImportFormat,
  type ImportRow,
  importStartTimes,
  localDate,
  type Project,
  readImportCsv,
  resolveBillable,
  type User,
  uuidv7,
} from "@stint/shared";
import { insertRow, listRows, TABLES, updateRow } from "../db/tables.ts";
import { audit } from "../lib/audit.ts";
import { invalidateAccessCache } from "./access.ts";
import { PROJECT_COLORS } from "./catalog.ts";
import { getOrgSettings } from "./org.ts";
import { isPeriodLocked, snapshotRate } from "./syncPush.ts";
import { bumpSyncEpoch } from "./users.ts";

export interface ImportOptions {
  csv: string;
  dryRun: boolean;
  /** Create clients, projects, tasks and tags that don't exist yet. */
  createMissing: boolean;
  /** Name or email in the file → Stint user id, for people whose names differ. */
  people: Record<string, string>;
  actorId: string;
  ip: string;
  now: number;
}

export interface ImportSummary {
  dryRun: boolean;
  format: ImportFormat;
  rows: number;
  imported: number;
  duplicates: number;
  locked: number;
  seconds: number;
  errors: { line: number; message: string }[];
  /** Names in the file that matched no one (map them with `people`). */
  unmatchedPeople: string[];
  created: { clients: string[]; projects: string[]; tasks: string[]; tags: string[] };
}

class Rollback extends Error {}

const key = (s: string) => s.trim().toLowerCase();

/**
 * Imports time entries from a CSV export. Everything happens in one transaction,
 * so a dry run is the real import rolled back: its counts are exact.
 * Re-importing the same file adds nothing (duplicates are skipped).
 */
export function importEntries(db: Database, opts: ImportOptions): ImportSummary {
  const parsed = readImportCsv(opts.csv);
  const summary: ImportSummary = {
    dryRun: opts.dryRun,
    format: parsed.format,
    rows: parsed.rows.length + parsed.errors.length,
    imported: 0,
    duplicates: 0,
    locked: 0,
    seconds: 0,
    errors: [...parsed.errors],
    unmatchedPeople: [],
    created: { clients: [], projects: [], tasks: [], tags: [] },
  };
  if (!parsed.rows.length) return summary;
  const settings = getOrgSettings(db);
  const now = opts.now;

  const run = () => {
    const users = listRows(db, TABLES.users, "deleted_at IS NULL") as User[];
    const byEmail = new Map(users.map((u) => [key(u.email), u.id]));
    const byName = new Map(users.map((u) => [key(u.name), u.id]));
    const mapped = new Map(Object.entries(opts.people).map(([k, v]) => [key(k), v]));
    const valid = new Set(users.map((u) => u.id));
    const userFor = (r: ImportRow): string | null => {
      for (const k of [r.email, r.person].filter(Boolean).map(key)) {
        const id = mapped.get(k) ?? byEmail.get(k) ?? byName.get(k);
        if (id && valid.has(id)) return id;
      }
      return null;
    };

    const clients = listRows(db, TABLES.clients, "deleted_at IS NULL") as Client[];
    const internal = clients.find((c) => c.isInternal)!;
    const clientByName = new Map(clients.map((c) => [key(c.name), c]));
    const projects = listRows(db, TABLES.projects, "deleted_at IS NULL") as Project[];
    const tags = listRows(db, TABLES.tags, "deleted_at IS NULL") as { id: string; name: string }[];
    const tagByName = new Map(tags.map((t) => [key(t.name), t.id]));
    const projectById = new Map(projects.map((p) => [p.id, p]));
    const memberships = new Set(
      db
        .query<{ project_id: string; user_id: string }, []>(
          "SELECT project_id, user_id FROM project_members WHERE deleted_at IS NULL",
        )
        .all()
        .map((m) => `${m.project_id}|${m.user_id}`),
    );

    const clientFor = (name: string): Client | null => {
      if (!name) return internal;
      const found = clientByName.get(key(name));
      if (found || !opts.createMissing) return found ?? null;
      const c = insertRow(db, TABLES.clients, {
        id: uuidv7(now),
        name: name.slice(0, 200),
        code: null,
        rate: null,
        isInternal: false,
        notes: "Imported",
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      }) as Client;
      clientByName.set(key(name), c);
      summary.created.clients.push(c.name);
      return c;
    };

    /** The item at `path` (project › … › item), created when allowed. `lastKind` labels a new last item. */
    const projectFor = (client: Client, path: string[], lastKind: string | null = null): Project | null => {
      let parent: Project | null = null;
      const done: string[] = [];
      const names = path.length ? path : ["Imported (no project)"];
      for (const [depth, name] of names.entries()) {
        done.push(name);
        const parentId: string | null = (parent as Project | null)?.id ?? null;
        let p: Project | undefined = projects.find(
          (x) => x.clientId === client.id && x.parentId === parentId && key(x.name) === key(name),
        );
        if (!p) {
          if (!opts.createMissing) return null;
          const siblings = projects.filter((x) => x.clientId === client.id && x.parentId === parentId);
          p = insertRow(db, TABLES.projects, {
            id: uuidv7(now),
            clientId: client.id,
            parentId,
            name: name.slice(0, 200),
            code: null,
            kind: depth === names.length - 1 ? lastKind : null,
            color: parent?.color ?? PROJECT_COLORS[projects.length % PROJECT_COLORS.length],
            billableDefault: parent?.billableDefault ?? !client.isInternal,
            rate: null,
            budgetMinutes: null,
            budgetAmount: null,
            visibility: client.isInternal ? "everyone" : "members",
            notes: "",
            sortOrder: siblings.reduce((m, s) => Math.max(m, s.sortOrder), -1) + 1,
            archivedAt: null,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          }) as Project;
          projects.push(p);
          projectById.set(p.id, p);
          summary.created.projects.push([client.name, ...done].join(" › "));
        }
        parent = p;
      }
      return parent;
    };

    const tagIdsFor = (names: string[]): string[] | null => {
      const ids: string[] = [];
      for (const n of names) {
        let id = tagByName.get(key(n));
        if (!id) {
          if (!opts.createMissing) return null;
          id = insertRow(db, TABLES.tags, {
            id: uuidv7(now),
            name: n.slice(0, 60),
            color: "#6b7280",
            archivedAt: null,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          }).id as string;
          tagByName.set(key(n), id);
          summary.created.tags.push(n);
        }
        ids.push(id);
      }
      return ids;
    };

    /** Members need to belong to a project to see it; membership on the top-level project covers its sub-projects. */
    const ensureMember = (project: Project, userId: string) => {
      let root = project;
      const chain = [project];
      while (root.parentId && projectById.get(root.parentId)) {
        root = projectById.get(root.parentId)!;
        chain.push(root);
      }
      if (project.visibility === "everyone" || chain.some((p) => memberships.has(`${p.id}|${userId}`)))
        return;
      const old = db
        .query<{ id: string }, [string, string]>(
          "SELECT id FROM project_members WHERE project_id = ? AND user_id = ?",
        )
        .get(root.id, userId);
      if (old) updateRow(db, TABLES.projectMembers, old.id, { deletedAt: null, role: "member" }, now);
      else
        insertRow(db, TABLES.projectMembers, {
          id: uuidv7(now),
          projectId: root.id,
          userId,
          role: "member",
          rate: null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        });
      memberships.add(`${root.id}|${userId}`);
      // Their copy lacks the project's older rows, so their next sync starts afresh.
      bumpSyncEpoch(db, userId, { withManager: true });
    };

    const unmatched = new Set<string>();
    const userIds = parsed.rows.map(userFor);
    const starts = importStartTimes(parsed.rows, (r) => userFor(r) ?? r.person, settings.timezone);
    const dup = db.query<{ n: number }, [string, string, number, number]>(
      "SELECT COUNT(*) AS n FROM time_entries WHERE user_id = ? AND project_id = ? AND started_at = ? AND duration_s = ? AND deleted_at IS NULL",
    );
    let touchedProjects = false;

    for (const [i, r] of parsed.rows.entries()) {
      const fail = (message: string) => {
        summary.errors.push({ line: r.line, message });
      };
      const userId = userIds[i];
      if (!userId) {
        unmatched.add(r.email || r.person);
        fail(`No one in Stint matches "${r.person || r.email}".`);
        continue;
      }
      if (r.durationS <= 0) {
        fail("The entry has no time.");
        continue;
      }
      const client = clientFor(r.client);
      if (!client) {
        fail(`There is no client called "${r.client}".`);
        continue;
      }
      const before = projects.length;
      // A task column (Toggl, Stint 0.1) is one more level: since 0.2 tasks are items in the tree.
      const path = r.task ? [...r.project, r.task] : r.project;
      const project = projectFor(client, path, r.task ? "Task" : null);
      if (!project) {
        fail(`There is no project called "${path.join(" › ")}" for ${client.name}.`);
        continue;
      }
      if (projects.length !== before) touchedProjects = true;
      const tagIds = tagIdsFor(r.tags);
      if (!tagIds) {
        fail(`Unknown tag in "${r.tags.join(", ")}".`);
        continue;
      }
      const startedAt = starts[i]!;
      const entryDate = localDate(startedAt, settings.timezone);
      if (dup.get(userId, project.id, startedAt, r.durationS)!.n > 0) {
        summary.duplicates++;
        continue;
      }
      if (isPeriodLocked(db, userId, entryDate)) {
        summary.locked++;
        fail("That period is submitted or approved, so it can't change. Unlock it first.");
        continue;
      }
      ensureMember(project, userId);
      touchedProjects = true;
      const entry = { userId, projectId: project.id, taskId: null };
      insertRow(db, TABLES.timeEntries, {
        id: uuidv7(startedAt),
        ...entry,
        description: r.description,
        startedAt,
        durationS: r.durationS,
        entryDate,
        billable: r.billable ?? resolveBillable(null, project),
        rateSnapshot: snapshotRate(db, entry, settings),
        currency: settings.currency,
        source: "import",
        tagIds,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
      summary.imported++;
      summary.seconds += r.durationS;
    }
    summary.unmatchedPeople = [...unmatched].sort();
    if (touchedProjects) invalidateAccessCache(db);

    if (!opts.dryRun && summary.imported + summary.created.projects.length > 0) {
      audit(db, now, {
        actorId: opts.actorId,
        action: "import",
        entity: "time_entry",
        entityId: null,
        before: null,
        after: {
          format: summary.format,
          imported: summary.imported,
          duplicates: summary.duplicates,
          errors: summary.errors.length,
          created: summary.created,
        },
        ip: opts.ip,
      });
    }
    if (opts.dryRun) throw new Rollback();
  };

  try {
    db.transaction(run)();
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
    invalidateAccessCache(db);
  }
  summary.errors = summary.errors.sort((a, b) => a.line - b.line).slice(0, 500);
  return summary;
}
