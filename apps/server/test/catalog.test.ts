import { describe, expect, test } from "bun:test";
import type { Client, Project, ProjectMember } from "@stint/shared";
import { createTestServer } from "./helpers.ts";

async function world() {
  const s = createTestServer();
  const admin = await s.setup();
  const mgr = await s.createUser(admin, {
    email: "mgr@example.com",
    name: "Lerato Manager",
    role: "manager",
  });
  const alice = await s.createUser(admin, { email: "alice@example.com", name: "Alice Member" });
  const bob = await s.createUser(admin, { email: "bob@example.com", name: "Bob Member" });
  const client = (
    await s.json<Client>("POST", "/api/clients", {
      as: admin,
      body: { name: "Drakenstein Municipality" },
    })
  ).body;
  const root = (
    await s.json<Project>("POST", "/api/projects", {
      as: admin,
      body: { clientId: client.id, name: "Paarl bridge" },
    })
  ).body;
  const sub = (
    await s.json<Project>("POST", "/api/projects", {
      as: admin,
      body: { parentId: root.id, name: "Detailed design" },
    })
  ).body;
  return { s, admin, mgr, alice, bob, client, root, sub };
}

describe("clients", () => {
  test("admin CRUD; members cannot create", async () => {
    const { s, admin, alice, client } = await world();
    expect(client.name).toBe("Drakenstein Municipality");
    const upd = await s.json<Client>("PATCH", `/api/clients/${client.id}`, {
      as: admin,
      body: { code: "DRK" },
    });
    expect(upd.body.code).toBe("DRK");
    expect((await s.json("POST", "/api/clients", { as: alice.agent, body: { name: "X" } })).status).toBe(403);
  });

  test("archive instead of delete; Internal cannot be archived", async () => {
    const { s, admin, client } = await world();
    const a = await s.json<Client>("POST", `/api/clients/${client.id}/archive`, { as: admin });
    expect(a.body.archivedAt).not.toBeNull();
    const list = await s.json<Client[]>("GET", "/api/clients", { as: admin });
    const internal = list.body.find((c) => c.isInternal)!;
    expect((await s.json("POST", `/api/clients/${internal.id}/archive`, { as: admin })).status).toBe(400);
  });

  test("members see only clients of projects they can track on", async () => {
    const { s, admin, alice, client, root } = await world();
    let list = await s.json<Client[]>("GET", "/api/clients", { as: alice.agent });
    expect(list.body.map((c) => c.name)).toEqual(["Internal"]);
    await s.json("PUT", `/api/projects/${root.id}/members/${alice.id}`, { as: admin, body: {} });
    list = await s.json<Client[]>("GET", "/api/clients", { as: alice.agent });
    expect(list.body.find((c) => c.id === client.id)).toBeDefined();
  });
});

describe("projects", () => {
  test("sub-projects inherit the client and colour", async () => {
    const { root, sub } = await world();
    expect(sub.clientId).toBe(root.clientId);
    expect(sub.parentId).toBe(root.id);
    expect(sub.color).toBe(root.color);
  });

  test("internal projects are open to everyone by default", async () => {
    const { s, admin } = await world();
    const clients = await s.json<Client[]>("GET", "/api/clients", { as: admin });
    const internal = clients.body.find((c) => c.isInternal)!;
    const p = await s.json<Project>("POST", "/api/projects", {
      as: admin,
      body: { clientId: internal.id, name: "ISO 9001" },
    });
    expect(p.body.visibility).toBe("everyone");
  });

  test("move re-parents and rejects cycles", async () => {
    const { s, admin, root, sub } = await world();
    const bad = await s.json("POST", `/api/projects/${root.id}/move`, {
      as: admin,
      body: { parentId: sub.id },
    });
    expect(bad.status).toBe(400);
    const wp = (
      await s.json<Project>("POST", "/api/projects", { as: admin, body: { parentId: sub.id, name: "WP 1" } })
    ).body;
    const moved = await s.json<Project>("POST", `/api/projects/${wp.id}/move`, {
      as: admin,
      body: { parentId: root.id },
    });
    expect(moved.body.parentId).toBe(root.id);
    const toTop = await s.json<Project>("POST", `/api/projects/${wp.id}/move`, {
      as: admin,
      body: { parentId: null },
    });
    expect(toTop.body.parentId).toBeNull();
  });

  test("moving to another client carries the whole subtree", async () => {
    const { s, admin, root, sub } = await world();
    const other = (
      await s.json<Client>("POST", "/api/clients", { as: admin, body: { name: "Stellenbosch University" } })
    ).body;
    await s.json("POST", `/api/projects/${root.id}/move`, {
      as: admin,
      body: { parentId: null, clientId: other.id },
    });
    const all = await s.json<Project[]>("GET", "/api/projects", { as: admin });
    expect(all.body.find((p) => p.id === sub.id)?.clientId).toBe(other.id);
  });

  test("managers manage only projects they are assigned to (inherited downwards)", async () => {
    const { s, admin, mgr, root, sub } = await world();
    expect(
      (await s.json("PATCH", `/api/projects/${sub.id}`, { as: mgr.agent, body: { name: "x" } })).status,
    ).toBe(403);
    await s.json("PUT", `/api/projects/${root.id}/members/${mgr.id}`, {
      as: admin,
      body: { role: "manager" },
    });
    expect(
      (await s.json("PATCH", `/api/projects/${sub.id}`, { as: mgr.agent, body: { name: "Design" } })).status,
    ).toBe(200);
    // can create sub-projects under managed projects, but not top-level ones
    expect(
      (await s.json("POST", "/api/projects", { as: mgr.agent, body: { parentId: sub.id, name: "WP" } }))
        .status,
    ).toBe(201);
    expect(
      (
        await s.json("POST", "/api/projects", {
          as: mgr.agent,
          body: { clientId: root.clientId, name: "Top" },
        })
      ).status,
    ).toBe(403);
  });

  test("members only see projects they're assigned to, plus 'everyone' projects", async () => {
    const { s, admin, alice, root, sub } = await world();
    let list = await s.json<Project[]>("GET", "/api/projects", { as: alice.agent });
    expect(list.body.some((p) => p.id === root.id)).toBe(false);
    expect(list.body.some((p) => p.name === "Leave")).toBe(true);
    await s.json("PUT", `/api/projects/${root.id}/members/${alice.id}`, { as: admin, body: {} });
    list = await s.json<Project[]>("GET", "/api/projects", { as: alice.agent });
    expect(list.body.some((p) => p.id === root.id)).toBe(true);
    expect(list.body.some((p) => p.id === sub.id)).toBe(true);
  });

  test("a member can't be made a project manager", async () => {
    const { s, admin, alice, root } = await world();
    const r = await s.json("PUT", `/api/projects/${root.id}/members/${alice.id}`, {
      as: admin,
      body: { role: "manager" },
    });
    expect(r.status).toBe(400);
  });

  test("membership can be removed and re-added", async () => {
    const { s, admin, alice, root } = await world();
    await s.json("PUT", `/api/projects/${root.id}/members/${alice.id}`, { as: admin, body: {} });
    expect(
      (await s.json("DELETE", `/api/projects/${root.id}/members/${alice.id}`, { as: admin })).status,
    ).toBe(200);
    let members = await s.json<ProjectMember[]>("GET", `/api/projects/${root.id}/members`, { as: admin });
    expect(members.body.length).toBe(0);
    await s.json("PUT", `/api/projects/${root.id}/members/${alice.id}`, { as: admin, body: {} });
    members = await s.json<ProjectMember[]>("GET", `/api/projects/${root.id}/members`, { as: admin });
    expect(members.body.length).toBe(1);
  });

  test("changes are audited", async () => {
    const { s, admin, root } = await world();
    await s.json("POST", `/api/projects/${root.id}/archive`, { as: admin });
    const actions = s.ctx.db
      .query<{ action: string }, [string]>(
        "SELECT action FROM audit_log WHERE entity = 'project' AND entity_id = ? ORDER BY id",
      )
      .all(root.id)
      .map((r) => r.action);
    expect(actions).toEqual(["create", "archive"]);
  });
});

describe("items and tags", () => {
  test("items nest as deep as needed with the firm's own types; members can't add them", async () => {
    const { s, admin, alice, root } = await world();
    let parentId = root.id;
    const kinds = ["Phase", "Work package", "Task", "Sub-task"];
    for (const kind of kinds) {
      const r = await s.json<Project>("POST", "/api/projects", {
        as: admin,
        body: { parentId, name: `${kind} 1`, kind },
      });
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ kind, clientId: root.clientId, parentId });
      parentId = r.body.id;
    }
    await s.json("PUT", `/api/projects/${root.id}/members/${alice.id}`, { as: admin, body: {} });
    const denied = await s.json("POST", "/api/projects", {
      as: alice.agent,
      body: { parentId: root.id, name: "Nope", kind: "Task" },
    });
    expect(denied.status).toBe(403);
    const list = await s.json<Project[]>("GET", "/api/projects", { as: alice.agent });
    const mine = list.body.filter((p) => p.clientId === root.clientId && p.kind);
    expect(mine.map((p) => p.kind)).toEqual(kinds);
    // The task routes are gone: tasks are items now.
    const gone = await s.json("POST", "/api/tasks", { as: admin, body: { projectId: root.id, name: "x" } });
    expect(gone.status).toBe(404);
  });

  test("anyone creates tags; duplicates are rejected case-insensitively", async () => {
    const { s, alice } = await world();
    expect((await s.json("POST", "/api/tags", { as: alice.agent, body: { name: "Overtime" } })).status).toBe(
      201,
    );
    expect((await s.json("POST", "/api/tags", { as: alice.agent, body: { name: "overtime" } })).status).toBe(
      409,
    );
  });
});
