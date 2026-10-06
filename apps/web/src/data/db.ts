import type {
  Client,
  Favorite,
  Organization,
  Project,
  ProjectMember,
  Tag,
  TimeEntry,
  Timesheet,
  User,
} from "@stint/shared";
import Dexie, { type Table } from "dexie";

export type SyncTable =
  | "users"
  | "clients"
  | "projects"
  | "projectMembers"
  | "tags"
  | "timesheets"
  | "timeEntries"
  | "favorites";

export const SYNC_TABLES: SyncTable[] = [
  "users",
  "clients",
  "projects",
  "projectMembers",
  "tags",
  "timesheets",
  "timeEntries",
  "favorites",
];

/** Tables the client may write to through the sync outbox. */
export type WritableTable = "timeEntries" | "favorites" | "tags";

export interface OutboxChange {
  seq?: number;
  changeId: string;
  table: WritableTable;
  id: string;
  /** "create" sends the full row; "update" sends only the changed fields. */
  op: "create" | "update" | "delete";
  patch: Record<string, unknown>;
  hlc: string;
  createdAt: number;
  attempts: number;
  lastError?: string;
}

export interface MetaRow {
  key: string;
  value: unknown;
}

export class StintDB extends Dexie {
  users!: Table<User, string>;
  clients!: Table<Client, string>;
  projects!: Table<Project, string>;
  projectMembers!: Table<ProjectMember, string>;
  tags!: Table<Tag, string>;
  timesheets!: Table<Timesheet, string>;
  timeEntries!: Table<TimeEntry, string>;
  favorites!: Table<Favorite, string>;
  outbox!: Table<OutboxChange, number>;
  meta!: Table<MetaRow, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      users: "id",
      clients: "id",
      projects: "id, clientId, parentId",
      projectMembers: "id, projectId, userId",
      tasks: "id, projectId",
      tags: "id",
      timesheets: "id, userId, periodStart",
      timeEntries: "id, userId, projectId, entryDate, startedAt, [userId+entryDate]",
      favorites: "id, userId",
      outbox: "++seq, changeId, table, [table+id]",
      meta: "key",
    });
    // 0.2: tasks became items in the project tree; the old store is dropped.
    this.version(2).stores({ tasks: null });
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return (await this.meta.get(key))?.value as T | undefined;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await this.meta.put({ key, value });
  }

  table_(name: SyncTable): Table<{ id: string }, string> {
    return this[name] as unknown as Table<{ id: string }, string>;
  }
}

export function dbName(serverId: string, userId: string): string {
  return `stint-${serverId}-${userId}`;
}

export type { Organization };
