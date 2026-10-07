/**
 * Demo company for evaluating Stint: 5 people, several clients, nested
 * projects, internal work and leave, and three months of realistic entries.
 *
 *   bun run seed                 # into apps/server/data (or $STINT_DATA_DIR)
 *   bun run seed -- --reset      # wipe that database first
 *
 * Everyone's password is printed at the end.
 */
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  addDays,
  dayOfWeek,
  endOfMonth,
  localDate,
  periodFor,
  startOfMonth,
  uuidv7,
  zonedToInstant,
} from "@stint/shared";
import { hashPassword } from "../src/auth/passwords.ts";
import { migrate } from "../src/db/migrate.ts";
import { migrations } from "../src/db/migrations/index.ts";
import { openDatabase } from "../src/db/open.ts";
import { insertRow, TABLES } from "../src/db/tables.ts";
import { getMeta, setMeta } from "../src/lib/meta.ts";
import { runSetup } from "../src/services/bootstrap.ts";
import { getOrgSettings } from "../src/services/org.ts";

const args = new Set(process.argv.slice(2));
const dataDir = resolve(process.env.STINT_DATA_DIR ?? join(import.meta.dir, "..", "data"));
const dbPath = join(dataDir, "stint.db");
if (args.has("--reset") && existsSync(dbPath)) {
  for (const f of ["stint.db", "stint.db-wal", "stint.db-shm"]) rmSync(join(dataDir, f), { force: true });
}
mkdirSync(dataDir, { recursive: true });
const db = openDatabase(dbPath);
migrate(db, migrations);
if (db.query("SELECT 1 FROM organization").get()) {
  console.error(`${dbPath} already has an organisation. Run with --reset to replace it.`);
  process.exit(1);
}
if (!getMeta(db, "server_id")) setMeta(db, "server_id", uuidv7());

/* deterministic randomness so demos look the same every time */
let seed = 20260930;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)]!;

const now = Date.now();
const PASSWORD = "stint demo 2026";
await runSetup(
  db,
  {
    organizationName: "Karoo Consulting Engineers",
    timezone: "Africa/Johannesburg",
    admin: { name: "Thandi Mokoena", email: "thandi@karoo.co.za", password: PASSWORD },
  },
  now,
  "seed",
);
db.query("UPDATE organization SET settings = json_patch(settings, ?) WHERE id = 'org'").run(
  JSON.stringify({
    pdf: {
      accentColor: "#1f5c4a",
      address: "14 Dorp Street\nStellenbosch 7600\nSouth Africa",
      registration: "2011/004217/07",
      footer: "Karoo Consulting Engineers (Pty) Ltd",
    },
  }),
);
const settings = getOrgSettings(db);
const tz = settings.timezone;
const hash = await hashPassword(PASSWORD);

const adminId = db.query<{ id: string }, []>("SELECT id FROM users WHERE role = 'admin'").get()!.id;

function user(
  name: string,
  email: string,
  role: "admin" | "manager" | "member",
  color: string,
  managerId: string | null,
) {
  const id = uuidv7();
  insertRow(db, TABLES.users, {
    id,
    email,
    name,
    role,
    color,
    active: true,
    mustChangePassword: false,
    managerId,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });
  db.query("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, id);
  return id;
}
const pieter = user("Pieter van Wyk", "pieter@karoo.co.za", "manager", "#2463a6", null);
const aisha = user("Aisha Patel", "aisha@karoo.co.za", "member", "#b86e12", pieter);
const sipho = user("Sipho Dlamini", "sipho@karoo.co.za", "member", "#6d5bd0", pieter);
const lerato = user("Lerato Nkosi", "lerato@karoo.co.za", "member", "#be185d", adminId);
const people = [adminId, pieter, aisha, sipho, lerato];

function client(name: string, code: string) {
  const id = uuidv7();
  insertRow(db, TABLES.clients, {
    id,
    name,
    code,
    isInternal: false,
    notes: "",
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });
  return id;
}
let sort = 0;
function project(
  clientId: string,
  parentId: string | null,
  name: string,
  extra: Record<string, unknown> = {},
) {
  const id = uuidv7();
  insertRow(db, TABLES.projects, {
    id,
    clientId,
    parentId,
    name,
    code: null,
    kind: null,
    color: "#1f5c4a",
    budgetMinutes: null,
    visibility: "members",
    notes: "",
    sortOrder: sort++,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...extra,
  });
  return id;
}
/** An item of kind "Task" under a project (tasks are items in the project tree since 0.2). */
function task(projectId: string, name: string) {
  const parent = db
    .query<{ client_id: string; color: string; visibility: string }, [string]>(
      "SELECT client_id, color, visibility FROM projects WHERE id = ?",
    )
    .get(projectId)!;
  return project(parent.client_id, projectId, name, {
    kind: "Task",
    color: parent.color,
    visibility: parent.visibility,
  });
}
function member(projectId: string, userId: string, role: "member" | "manager" = "member") {
  insertRow(db, TABLES.projectMembers, {
    id: uuidv7(),
    projectId,
    userId,
    role,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });
}

const drakenstein = client("Drakenstein Municipality", "DRK");
const winelands = client("Cape Winelands Water", "CWW");
const stellies = client("Stellenbosch University", "SU");
const ferrum = client("Ferrum Mining (Pty) Ltd", "FER");

const bridge = project(drakenstein, null, "Paarl bridge upgrade", {
  code: "2026-014",
  color: "#b3361f",
  budgetMinutes: 900 * 60,
});
const design = project(drakenstein, bridge, "Detailed design", { color: "#b3361f", kind: "Phase" });
const wp1 = project(drakenstein, design, "WP1 Structural", { color: "#b3361f", kind: "Work package" });
const wp2 = project(drakenstein, design, "WP2 Geotechnical", {
  color: "#b3361f",
  kind: "Work package",
});
const monitoring = project(drakenstein, bridge, "Construction monitoring", {
  color: "#b3361f",
  kind: "Phase",
});
const roads = project(drakenstein, null, "Rural roads assessment", {
  code: "2026-022",
  color: "#ca8a04",
  budgetMinutes: 160 * 60,
});
const pipeline = project(winelands, null, "Berg River pipeline", {
  code: "2026-009",
  color: "#2463a6",
  budgetMinutes: 600 * 60,
});
const pumps = project(winelands, pipeline, "Pump station design", { color: "#2463a6", kind: "Phase" });
const eia = project(winelands, pipeline, "Environmental approvals", { color: "#2463a6", kind: "Phase" });
const lab = project(stellies, null, "Structures lab refurbishment", {
  code: "2026-031",
  color: "#0f766e",
});
const tailings = project(ferrum, null, "Tailings dam inspection", {
  code: "2026-017",
  color: "#6d5bd0",
  budgetMinutes: 120 * 60,
});

const siteVisit = task(monitoring, "Site visit");
task(bridge, "Site visit");
const reportWriting = task(bridge, "Report writing");
const drawings = task(design, "Drawings & modelling");
task(pipeline, "Meetings");
const routeWork = task(pipeline, "Route & wayleaves");
const tailingsSite = task(tailings, "Site inspection");
const stability = task(tailings, "Stability analysis");

member(bridge, pieter, "manager");
member(bridge, aisha);
member(bridge, sipho);
member(roads, sipho);
member(roads, lerato);
member(pipeline, pieter, "manager");
member(pipeline, aisha);
member(pipeline, lerato);
member(lab, lerato);
member(lab, sipho);
member(tailings, pieter, "manager");
member(tailings, aisha);

// New companies start with nothing under Internal; the demo adds the usual admin, training and leave.
const demoInternal: { name: string; code: string; color: string; items: string[] }[] = [
  {
    name: "Administration",
    code: "INT-ADM",
    color: "#64748b",
    items: ["Timesheets & admin", "Meetings", "IT & equipment"],
  },
  {
    name: "Business development",
    code: "INT-BD",
    color: "#b7791f",
    items: ["Proposals", "Client meetings", "Marketing"],
  },
  { name: "Training", code: "INT-TRN", color: "#6d5bd0", items: ["Courses", "Conferences", "CPD"] },
  { name: "Research & development", code: "INT-RD", color: "#0f766e", items: [] },
  {
    name: "Leave",
    code: "INT-LV",
    color: "#9ca3af",
    items: ["Annual leave", "Sick leave", "Family responsibility", "Public holiday"],
  },
];
{
  const internalClient = db
    .query<{ id: string }, []>("SELECT id FROM clients WHERE is_internal = 1")
    .get()!.id;
  const row = (over: Record<string, unknown>) => ({
    parentId: null,
    code: null,
    kind: null,
    budgetMinutes: null,
    visibility: "everyone",
    notes: "",
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    clientId: internalClient,
    ...over,
  });
  demoInternal.forEach((p, n) => {
    const id = uuidv7(now);
    insertRow(
      db,
      TABLES.projects,
      row({ id, name: p.name, code: p.code, color: p.color, sortOrder: n }) as never,
    );
    p.items.forEach((t, k) => {
      insertRow(
        db,
        TABLES.projects,
        row({ id: uuidv7(now), parentId: id, name: t, kind: "Task", color: p.color, sortOrder: k }) as never,
      );
    });
  });
}

const internal = Object.fromEntries(
  db
    .query<{ id: string; name: string }, []>(
      "SELECT p.id, p.name FROM projects p JOIN clients c ON c.id = p.client_id WHERE c.is_internal = 1",
    )
    .all()
    .map((p) => [p.name, p.id]),
);
/** The items under an internal project, by name. */
const itemsOf = (projectId: string) =>
  Object.fromEntries(
    db
      .query<{ id: string; name: string }, [string]>("SELECT id, name FROM projects WHERE parent_id = ?")
      .all(projectId)
      .map((t) => [t.name, t.id]),
  ) as Record<string, string>;
const leaveTasks = itemsOf(internal.Leave!);
const adminItems = itemsOf(internal.Administration!);
const bizDevItems = itemsOf(internal["Business development"]!);
const trainingItems = itemsOf(internal.Training!);

/* who works on what (weights) */
const work: Record<string, [string, string | null, number, string[]][]> = {
  [adminId]: [
    [bizDevItems.Proposals!, null, 2, ["Proposal for Overstrand coastal study", "Tender documents"]],
    [bizDevItems["Client meetings"]!, null, 1, ["Client meeting — Ferrum"]],
    [bridge, reportWriting, 2, ["Review of design report", "Progress report to council"]],
    [adminItems["Timesheets & admin"]!, null, 2, ["Invoicing", "Timesheet approvals"]],
  ],
  [pieter]: [
    [design, drawings, 3, ["Deck reinforcement check", "Bearing layout", "Design review with Aisha"]],
    [monitoring, siteVisit, 2, ["Weekly site meeting", "Pour inspection"]],
    [pumps, null, 2, ["Pump selection", "Hydraulic model update"]],
    [tailings, tailingsSite, 1, ["Annual inspection", "Piezometer data review"]],
  ],
  [aisha]: [
    [wp1, null, 4, ["Pier design", "Load combinations", "Revit model"]],
    [wp2, null, 2, ["Borehole logs", "Pile capacity"]],
    [eia, null, 2, ["Water use licence application", "Specialist study review"]],
    [tailings, stability, 1, ["Stability analysis"]],
  ],
  [sipho]: [
    [monitoring, siteVisit, 3, ["Daily site diary", "Concrete cube results"]],
    [roads, null, 3, ["Road condition survey", "Culvert inventory"]],
    [lab, null, 1, ["Crane beam check"]],
  ],
  [lerato]: [
    [roads, null, 2, ["GIS mapping", "Traffic counts"]],
    [pipeline, routeWork, 3, ["Route alignment drawings", "Wayleave applications"]],
    [lab, null, 2, ["Bill of quantities", "Tender drawings"]],
  ],
};

const today = localDate(now, tz);
const start = startOfMonth(addDays(startOfMonth(today), -62));
const internalExtras: [string, string | null, string][] = [
  [adminItems.Meetings!, null, "Staff meeting"],
  [trainingItems.CPD!, null, "ECSA CPD webinar"],
  [internal["Research & development"]!, null, "Spreadsheet tools for load checks"],
];

let entries = 0;
const entrySql = (
  userId: string,
  projectId: string,
  taskId: string | null,
  description: string,
  startedAt: number,
  durationS: number,
) => {
  const e = {
    id: uuidv7(startedAt),
    userId,
    // A "task" here is an item under the project: time goes on the item itself.
    projectId: taskId ?? projectId,
    taskId: null,
    description,
    startedAt,
    durationS,
    entryDate: localDate(startedAt, tz),
    source: rnd() < 0.5 ? "grid" : "manual",
    tagIds: [],
    createdAt: startedAt,
    updatedAt: startedAt,
    deletedAt: null,
  };
  insertRow(db, TABLES.timeEntries, e);
  entries++;
};

db.transaction(() => {
  for (let d = start; d <= today; d = addDays(d, 1)) {
    if (!settings.workingDays.includes(dayOfWeek(d))) continue;
    for (const uid of people) {
      // leave: a few days each; one person on a week's leave
      const r = rnd();
      if (r < 0.03 || (uid === lerato && d >= addDays(start, 30) && d < addDays(start, 35))) {
        entrySql(
          uid,
          internal.Leave!,
          uid === lerato
            ? leaveTasks["Annual leave"]!
            : pick([leaveTasks["Sick leave"]!, leaveTasks["Annual leave"]!]),
          "",
          zonedToInstant(d, "08:00", tz),
          8 * 3600,
        );
        continue;
      }
      if (d === today && uid !== pieter) continue; // today's time is still being tracked
      let t = zonedToInstant(d, pick(["07:30", "07:45", "08:00", "08:15", "08:30"]), tz);
      let remaining = Math.round((7.25 + rnd() * 1.5) * 4) * 900;
      // a little internal time most days
      if (rnd() < 0.7) {
        const [p, tk, desc] = pick(internalExtras);
        const dur = pick([1800, 2700, 3600]);
        entrySql(uid, p, tk, desc, t, dur);
        t += dur * 1000;
        remaining -= dur;
      }
      const options = work[uid]!;
      const weights = options.flatMap((o, i) => Array(o[2]).fill(i) as number[]);
      while (remaining > 1800) {
        const [p, tk, , descs] = options[pick(weights)]!;
        const dur = Math.min(remaining, pick([3600, 5400, 7200, 9000, 10800]) + Math.round(rnd() * 4) * 300);
        entrySql(uid, p, tk, pick(descs), t, dur);
        t += dur * 1000 + (rnd() < 0.3 ? 45 * 60_000 : 0); // lunch
        remaining -= dur;
      }
    }
  }

  // timesheets: previous months approved, last month partly submitted
  const months: string[] = [];
  for (let m = start; m < startOfMonth(today); m = addDays(endOfMonth(m), 1)) months.push(m);
  for (const m of months) {
    const p = periodFor(m, "month", settings.approvalDay);
    const isLast = m === months.at(-1);
    for (const uid of people) {
      const status = !isLast
        ? "approved"
        : uid === sipho
          ? "draft"
          : uid === lerato
            ? "submitted"
            : uid === aisha
              ? "submitted"
              : "approved";
      if (status === "draft") continue;
      const approver = uid === adminId || uid === pieter || uid === lerato ? adminId : pieter;
      insertRow(db, TABLES.timesheets, {
        id: uuidv7(),
        userId: uid,
        periodStart: p.start,
        periodEnd: p.end,
        status,
        submittedAt: zonedToInstant(addDays(p.end, 1), "09:00", tz),
        decidedBy: status === "approved" ? approver : null,
        decidedAt: status === "approved" ? zonedToInstant(addDays(p.end, 3), "10:00", tz) : null,
        comment: "",
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
    }
  }
})();

console.log(`Seeded ${entries} time entries from ${start} to ${today} into ${dbPath}`);
console.log("\nSign in with any of these (password for all: %s):", PASSWORD);
for (const [n, e, r] of <[string, string, string][]>[
  ["Thandi Mokoena", "thandi@karoo.co.za", "admin"],
  ["Pieter van Wyk", "pieter@karoo.co.za", "manager"],
  ["Aisha Patel", "aisha@karoo.co.za", "member"],
  ["Sipho Dlamini", "sipho@karoo.co.za", "member"],
  ["Lerato Nkosi", "lerato@karoo.co.za", "member"],
]) {
  console.log(`  ${r.padEnd(8)} ${n.padEnd(16)} ${e}`);
}
db.close();
