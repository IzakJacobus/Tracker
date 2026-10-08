import { describe, expect, test } from "bun:test";
import {
  type AccessContext,
  type Actor,
  canApproveTimesheet,
  canCreateProject,
  canEditEntry,
  canManageClients,
  canManageProject,
  canTrackOnProject,
  canUnlockTimesheet,
  canViewEntry,
  canViewProject,
  canViewUserTime,
  projectLineage,
  projectRoleFor,
} from "../src/permissions.ts";

const admin: Actor = { id: "admin", role: "admin" };
const mgr: Actor = { id: "mgr", role: "manager" };
const alice: Actor = { id: "alice", role: "member" };
const bob: Actor = { id: "bob", role: "member" };

// Tree: acme → acme-bridge → acme-bridge-design ; internal (everyone) → leave
function ctxFor(actor: Actor, extra: Partial<AccessContext> = {}): AccessContext {
  const memberships = new Map<string, "member" | "manager">();
  if (actor.id === "mgr") memberships.set("acme", "manager");
  if (actor.id === "alice") memberships.set("acme-bridge", "member");
  return {
    projectParent: new Map([
      ["acme", null],
      ["acme-bridge", "acme"],
      ["acme-bridge-design", "acme-bridge"],
      ["other", null],
      ["internal", null],
      ["leave", "internal"],
    ]),
    projectVisibility: new Map([
      ["acme", "members"],
      ["acme-bridge", "members"],
      ["acme-bridge-design", "members"],
      ["other", "members"],
      ["internal", "everyone"],
      ["leave", "members"],
    ]),
    memberships,
    userManager: new Map([
      ["alice", "mgr"],
      ["bob", null],
      ["mgr", null],
    ]),
    ...extra,
  };
}

describe("project lineage", () => {
  test("walks to the root", () => {
    expect(projectLineage("acme-bridge-design", ctxFor(admin))).toEqual([
      "acme-bridge-design",
      "acme-bridge",
      "acme",
    ]);
  });
  test("survives cycles", () => {
    const ctx = ctxFor(admin, {
      projectParent: new Map([
        ["a", "b"],
        ["b", "a"],
      ]),
    });
    expect(projectLineage("a", ctx)).toEqual(["a", "b"]);
  });
});

describe("tracking permissions", () => {
  test("membership is inherited by sub-projects", () => {
    expect(canTrackOnProject(alice, "acme-bridge-design", ctxFor(alice))).toBe(true);
    expect(projectRoleFor(alice, "acme-bridge-design", ctxFor(alice))).toBe("member");
  });
  test("membership does not leak upwards or sideways", () => {
    expect(canTrackOnProject(alice, "acme", ctxFor(alice))).toBe(false);
    expect(canTrackOnProject(alice, "other", ctxFor(alice))).toBe(false);
  });
  test("'everyone' projects are open to all, including descendants", () => {
    expect(canTrackOnProject(bob, "internal", ctxFor(bob))).toBe(true);
    expect(canTrackOnProject(bob, "leave", ctxFor(bob))).toBe(true);
  });
  test("admins can track anywhere, but not on unknown projects", () => {
    expect(canTrackOnProject(admin, "other", ctxFor(admin))).toBe(true);
    expect(canTrackOnProject(admin, "nope", ctxFor(admin))).toBe(false);
  });
});

describe("project visibility for managers", () => {
  const other: Actor = { id: "mgr2", role: "manager" };
  test("a manager sees the projects their team works on (and sub-projects), without tracking on them", () => {
    const ctx = ctxFor(other, { teamProjects: new Set(["acme-bridge"]) });
    expect(canViewProject(other, "acme-bridge", ctx)).toBe(true);
    expect(canViewProject(other, "acme-bridge-design", ctx)).toBe(true);
    expect(canViewProject(other, "acme", ctx)).toBe(false);
    expect(canViewProject(other, "other", ctx)).toBe(false);
    expect(canTrackOnProject(other, "acme-bridge", ctx)).toBe(false);
  });
  test("team projects never widen what a member sees", () => {
    expect(canViewProject(bob, "acme-bridge", ctxFor(bob, { teamProjects: new Set(["acme-bridge"]) }))).toBe(
      false,
    );
  });
});

describe("project management", () => {
  test("manager manages assigned subtree only", () => {
    expect(canManageProject(mgr, "acme-bridge-design", ctxFor(mgr))).toBe(true);
    expect(canManageProject(mgr, "other", ctxFor(mgr))).toBe(false);
  });
  test("a member with a 'manager' membership is still only a member", () => {
    const ctx = ctxFor(alice, { memberships: new Map([["acme", "manager"]]) });
    expect(canManageProject(alice, "acme", ctx)).toBe(false);
  });
  test("only admins create top-level projects; managers create under managed parents", () => {
    expect(canCreateProject(admin, null, ctxFor(admin))).toBe(true);
    expect(canCreateProject(mgr, null, ctxFor(mgr))).toBe(false);
    expect(canCreateProject(mgr, "acme-bridge", ctxFor(mgr))).toBe(true);
    expect(canCreateProject(mgr, "other", ctxFor(mgr))).toBe(false);
  });
  test("clients are admin-only", () => {
    expect(canManageClients(admin)).toBe(true);
    expect(canManageClients(mgr)).toBe(false);
    expect(canManageClients(alice)).toBe(false);
  });
});

describe("time visibility", () => {
  test("members see only their own time", () => {
    expect(canViewUserTime(alice, "alice", ctxFor(alice))).toBe(true);
    expect(canViewUserTime(alice, "bob", ctxFor(alice))).toBe(false);
    expect(canViewEntry(alice, { userId: "bob", projectId: "acme-bridge" }, ctxFor(alice))).toBe(false);
  });
  test("managers see their team and entries on projects they manage", () => {
    expect(canViewUserTime(mgr, "alice", ctxFor(mgr))).toBe(true);
    expect(canViewUserTime(mgr, "bob", ctxFor(mgr))).toBe(false);
    expect(canViewEntry(mgr, { userId: "bob", projectId: "acme-bridge" }, ctxFor(mgr))).toBe(true);
    expect(canViewEntry(mgr, { userId: "bob", projectId: "other" }, ctxFor(mgr))).toBe(false);
  });
  test("only the owner or an admin edits an entry", () => {
    expect(canEditEntry(alice, { userId: "alice" })).toBe(true);
    expect(canEditEntry(mgr, { userId: "alice" })).toBe(false);
    expect(canEditEntry(admin, { userId: "alice" })).toBe(true);
  });
});

describe("timesheet approval", () => {
  test("managers approve their team, never themselves", () => {
    expect(canApproveTimesheet(mgr, "alice", ctxFor(mgr))).toBe(true);
    expect(canApproveTimesheet(mgr, "bob", ctxFor(mgr))).toBe(false);
    expect(canApproveTimesheet(mgr, "mgr", ctxFor(mgr))).toBe(false);
  });
  test("members cannot approve", () => {
    expect(canApproveTimesheet(alice, "bob", ctxFor(alice))).toBe(false);
  });
  test("admins approve and unlock", () => {
    expect(canApproveTimesheet(admin, "alice", ctxFor(admin))).toBe(true);
    expect(canUnlockTimesheet(admin)).toBe(true);
    expect(canUnlockTimesheet(mgr)).toBe(false);
  });
});

describe("added to an item only", () => {
  test("sees the project and levels above it, but can only log on the item", () => {
    const ctx: AccessContext = {
      projectParent: new Map([
        ["root", null],
        ["mid", "root"],
        ["leaf", "mid"],
        ["sibling", "mid"],
        ["other", null],
      ]),
      projectVisibility: new Map([
        ["root", "members"],
        ["mid", "members"],
        ["leaf", "members"],
        ["sibling", "members"],
        ["other", "members"],
      ]),
      memberships: new Map([["leaf", "member"]]),
      userManager: new Map(),
    };
    const worker = { id: "w", role: "member" as const };
    expect(canTrackOnProject(worker, "leaf", ctx)).toBe(true);
    expect(canTrackOnProject(worker, "mid", ctx)).toBe(false);
    expect(canViewProject(worker, "root", ctx)).toBe(true);
    expect(canViewProject(worker, "mid", ctx)).toBe(true);
    expect(canViewProject(worker, "leaf", ctx)).toBe(true);
    // Not the item's neighbours, and not unrelated projects.
    expect(canViewProject(worker, "sibling", ctx)).toBe(false);
    expect(canViewProject(worker, "other", ctx)).toBe(false);
  });
});
