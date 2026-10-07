import { z } from "zod";
import { isValidIsoDate } from "./dates.ts";

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

export const Id = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, {
    message: "Invalid id",
  });
export const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Use YYYY-MM-DD" })
  .refine(isValidIsoDate, { message: "That date doesn't exist." });
export const Clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "Use HH:MM" });
export const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/, { message: "Use a #rrggbb colour" });
export const Email = z.string().trim().toLowerCase().email().max(254);
export const Name = z.string().trim().min(1, "Required").max(200);
export const Role = z.enum(["admin", "manager", "member"]);
export type Role = z.infer<typeof Role>;

/* ------------------------------------------------------------------ */
/* Organisation                                                        */
/* ------------------------------------------------------------------ */

export const DateFormat = z.enum(["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY", "D MMM YYYY"]);
export type DateFormat = z.infer<typeof DateFormat>;

export const OrgSettings = z.object({
  locale: z.string().min(2).max(20).default("en-ZA"),
  timezone: z.string().min(1).max(64).default("Africa/Johannesburg"),
  weekStart: z.number().int().min(0).max(6).default(1),
  dateFormat: DateFormat.default("YYYY-MM-DD"),
  timeFormat: z.enum(["24h", "12h"]).default("24h"),
  workdayMinutes: z
    .number()
    .int()
    .min(0)
    .max(24 * 60)
    .default(480),
  workingDays: z.array(z.number().int().min(0).max(6)).max(7).default([1, 2, 3, 4, 5]),
  workdayStart: Clock.default("08:00"),
  approvalPeriod: z.enum(["week", "biweek", "month"]).default("week"),
  /** The day a week (or fortnight) of hours ends and is handed in: 0 = Sunday … 5 = Friday. */
  approvalDay: z.number().int().min(0).max(6).default(5),
  reminders: z
    .object({
      enabled: z.boolean().default(true),
      time: Clock.default("16:30"),
      minMinutes: z
        .number()
        .int()
        .min(0)
        .max(24 * 60)
        .default(420),
    })
    .default({ enabled: true, time: "16:30", minMinutes: 420 }),
  pdf: z
    .object({
      accentColor: Color.default("#1f5c4a"),
      address: z.string().max(500).default(""),
      registration: z.string().max(120).default(""),
      footer: z.string().max(300).default(""),
    })
    .default({ accentColor: "#1f5c4a", address: "", registration: "", footer: "" }),
  backup: z
    .object({
      folder: z.string().max(1000).nullable().default(null),
      time: Clock.default("02:00"),
      keep: z.number().int().min(1).max(365).default(30),
    })
    .default({ folder: null, time: "02:00", keep: 30 }),
  sleepGuard: z.boolean().default(true),
  remoteAccess: z
    .object({
      enabled: z.boolean().default(false),
      provider: z.enum(["tailscale", "cloudflare"]).default("tailscale"),
    })
    .default({ enabled: false, provider: "tailscale" }),
});
export type OrgSettings = z.infer<typeof OrgSettings>;
export const defaultOrgSettings = (): OrgSettings => OrgSettings.parse({});

export const OrgSettingsPatch = OrgSettings.partial();

export const Organization = z.object({
  id: z.literal("org"),
  name: Name,
  settings: OrgSettings,
  logo: z.string().nullable(),
  updatedAt: z.number(),
  serverSeq: z.number(),
});
export type Organization = z.infer<typeof Organization>;

/** Logos are stored inline as data URLs; keep them small. */
export const LogoDataUrl = z
  .string()
  .max(700_000, "Logo must be smaller than 500 KB")
  .regex(/^data:image\/(png|jpeg|svg\+xml|webp);base64,[A-Za-z0-9+/=]+$/, {
    message: "Logo must be a PNG, JPEG, SVG or WebP image",
  });

/* ------------------------------------------------------------------ */
/* Synced entity rows (wire format, camelCase)                         */
/* ------------------------------------------------------------------ */

const syncMeta = {
  id: Id,
  createdAt: z.number(),
  updatedAt: z.number(),
  deletedAt: z.number().nullable(),
  serverSeq: z.number(),
};

export const User = z.object({
  ...syncMeta,
  email: Email,
  name: Name,
  role: Role,
  color: Color,
  active: z.boolean(),
  mustChangePassword: z.boolean(),
  managerId: Id.nullable(),
});
export type User = z.infer<typeof User>;

export const Client = z.object({
  ...syncMeta,
  name: Name,
  code: z.string().max(40).nullable(),
  isInternal: z.boolean(),
  notes: z.string().max(5000),
  archivedAt: z.number().nullable(),
});
export type Client = z.infer<typeof Client>;

export const ProjectVisibility = z.enum(["members", "everyone"]);
export const Project = z.object({
  ...syncMeta,
  clientId: Id,
  parentId: Id.nullable(),
  name: Name,
  code: z.string().max(40).nullable(),
  /** What the firm calls this item ("Phase", "Task", ...). Only a label: every item behaves the same. */
  kind: z.string().max(40).nullable().default(null),
  color: Color,
  budgetMinutes: z.number().int().min(0).nullable(),
  visibility: ProjectVisibility,
  notes: z.string().max(5000),
  sortOrder: z.number(),
  archivedAt: z.number().nullable(),
});
export type Project = z.infer<typeof Project>;

export const ProjectMember = z.object({
  ...syncMeta,
  projectId: Id,
  userId: Id,
  role: z.enum(["member", "manager"]),
});
export type ProjectMember = z.infer<typeof ProjectMember>;

export const Tag = z.object({
  ...syncMeta,
  name: z.string().trim().min(1).max(60),
  color: Color,
  archivedAt: z.number().nullable(),
});
export type Tag = z.infer<typeof Tag>;

/** "timer" only on entries from 0.1, which had a timer. */
export const EntrySource = z.enum(["timer", "manual", "grid", "import"]);
export const MAX_ENTRY_SECONDS = 24 * 3600;

export const TimeEntry = z.object({
  ...syncMeta,
  userId: Id,
  projectId: Id,
  /** Always null since 0.2: tasks are items in the project tree. */
  taskId: Id.nullable(),
  description: z.string().max(2000),
  /** Orders entries within a day; people only enter the date and hours. */
  startedAt: z.number().int(),
  /** Hours worked, in seconds (null only for timers left running in 0.1). */
  durationS: z.number().int().min(0).max(MAX_ENTRY_SECONDS).nullable(),
  entryDate: IsoDate,
  source: EntrySource,
  tagIds: z.array(Id).max(20),
});
export type TimeEntry = z.infer<typeof TimeEntry>;

export const TimesheetStatus = z.enum(["draft", "submitted", "approved", "rejected"]);
export type TimesheetStatus = z.infer<typeof TimesheetStatus>;
export const Timesheet = z.object({
  ...syncMeta,
  userId: Id,
  periodStart: IsoDate,
  periodEnd: IsoDate,
  status: TimesheetStatus,
  submittedAt: z.number().nullable(),
  decidedBy: Id.nullable(),
  decidedAt: z.number().nullable(),
  comment: z.string().max(2000),
});
export type Timesheet = z.infer<typeof Timesheet>;

export const Favorite = z.object({
  ...syncMeta,
  userId: Id,
  projectId: Id,
  taskId: Id.nullable(),
  sortOrder: z.number(),
});
export type Favorite = z.infer<typeof Favorite>;

/* ------------------------------------------------------------------ */
/* Auth / setup inputs                                                 */
/* ------------------------------------------------------------------ */

export const Password = z.string().min(10, "Use at least 10 characters").max(200);

export const LoginInput = z.object({
  email: Email,
  password: z.string().min(1).max(200),
});

export const SetupInput = z.object({
  organizationName: Name,
  timezone: z.string().min(1).max(64).default("Africa/Johannesburg"),
  admin: z.object({ name: Name, email: Email, password: Password }),
});
export type SetupInput = z.infer<typeof SetupInput>;

export const ChangePasswordInput = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: Password,
});

export const CreateUserInput = z.object({
  id: Id.optional(),
  email: Email,
  name: Name,
  role: Role.default("member"),
  password: Password,
  color: Color.default("#2f7d63"),
  managerId: Id.nullable().default(null),
});

export const UpdateUserInput = z
  .object({
    email: Email,
    name: Name,
    role: Role,
    color: Color,
    active: z.boolean(),
    managerId: Id.nullable(),
  })
  .partial();

export const ResetPasswordInput = z.object({ password: Password });

/* ------------------------------------------------------------------ */
/* Clients, projects (and their items), tags, members                 */
/* ------------------------------------------------------------------ */

const optionalCode = z.string().trim().max(40).nullable().optional();

export const CreateClientInput = z.object({
  id: Id.optional(),
  name: Name,
  code: optionalCode,
  notes: z.string().max(5000).optional(),
});
export const UpdateClientInput = CreateClientInput.omit({ id: true }).partial();

export const CreateProjectInput = z.object({
  id: Id.optional(),
  clientId: Id.optional(),
  parentId: Id.nullable().optional(),
  name: Name,
  code: optionalCode,
  kind: z.string().trim().max(40).nullable().optional(),
  color: Color.optional(),
  budgetMinutes: z.number().int().min(0).max(10_000_000).nullable().optional(),
  visibility: ProjectVisibility.optional(),
  notes: z.string().max(5000).optional(),
});
export const UpdateProjectInput = CreateProjectInput.omit({
  id: true,
  clientId: true,
  parentId: true,
}).partial();

export const MoveProjectInput = z.object({
  parentId: Id.nullable(),
  /** Only when moving a top-level project to another client (admins). */
  clientId: Id.optional(),
  sortOrder: z.number().optional(),
});

export const CreateTagInput = z.object({
  id: Id.optional(),
  name: z.string().trim().min(1).max(60),
  color: Color.optional(),
});
export const UpdateTagInput = CreateTagInput.omit({ id: true }).partial();

export const SetMemberInput = z.object({
  role: z.enum(["member", "manager"]).default("member"),
});
