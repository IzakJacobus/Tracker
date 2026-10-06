import { describe, expect, test } from "bun:test";
import type { Client, Project } from "@stint/shared";
import { createTestServer } from "./helpers.ts";

interface Pull {
  changes: Record<
    string,
    ({ id: string; name?: string; deletedAt?: number | null } & Record<string, unknown>)[]
  >;
  organization: { name: string } | null;
  cursor: number;
  hasMore: boolean;
  epoch: string;
}

describe("sync pull", () => {
  test("a full pull returns everything visible; an incremental pull returns only changes", async () => {
    const s = createTestServer();
    const admin = await s.setup();
    const full = await s.json<Pull>("GET", "/api/sync/pull?since=0", { as: admin });
    expect(full.status).toBe(200);
    expect(full.body.organization?.name).toBe("Karoo Consulting Engineers");
    // 5 internal projects plus the 13 items under them (Annual leave, Meetings, ...).
    expect(full.body.changes.projects?.length).toBe(18);
    expect(full.body.changes.users?.length).toBe(1);
    expect(full.body.hasMore).toBe(false);

    const again = await s.json<Pull>("GET", `/api/sync/pull?since=${full.body.cursor}`, { as: admin });
    expect(Object.keys(again.body.changes)).toEqual([]);
    expect(again.body.organization).toBeNull();

    const c = await s.json<Client>("POST", "/api/clients", { as: admin, body: { name: "New client" } });
    const inc = await s.json<Pull>("GET", `/api/sync/pull?since=${full.body.cursor}`, { as: admin });
    expect(inc.body.changes.clients?.map((x) => x.id)).toEqual([c.body.id]);
  });

  test("paging never skips rows", async () => {
    const s = createTestServer();
    const admin = await s.setup();
    for (let i = 0; i < 7; i++) await s.json("POST", "/api/tags", { as: admin, body: { name: `tag ${i}` } });
    const seen = new Set<string>();
    let since = 0;
    let pages = 0;
    for (;;) {
      const r = await s.json<Pull>("GET", `/api/sync/pull?since=${since}&limit=3`, { as: admin });
      for (const rows of Object.values(r.body.changes)) for (const row of rows) seen.add(row.id);
      since = r.body.cursor;
      pages++;
      if (!r.body.hasMore) break;
    }
    const total = s.ctx.db
      .query<{ n: number }, []>(
        "SELECT (SELECT COUNT(*) FROM users)+(SELECT COUNT(*) FROM clients)+(SELECT COUNT(*) FROM projects)+(SELECT COUNT(*) FROM tasks)+(SELECT COUNT(*) FROM tags) AS n",
      )
      .get()!.n;
    expect(seen.size).toBe(total);
    expect(pages).toBeGreaterThan(3);
  });

  test("members only receive what they may see; no row carries billing fields", async () => {
    const s = createTestServer();
    const admin = await s.setup();
    const alice = await s.createUser(admin, { email: "alice@example.com", name: "Alice" });
    await s.createUser(admin, { email: "bob@example.com", name: "Bob" });
    const client = (await s.json<Client>("POST", "/api/clients", { as: admin, body: { name: "Acme" } })).body;
    const secret = (
      await s.json<Project>("POST", "/api/projects", {
        as: admin,
        body: { clientId: client.id, name: "Secret" },
      })
    ).body;
    const mine = (
      await s.json<Project>("POST", "/api/projects", {
        as: admin,
        body: { clientId: client.id, name: "Mine" },
      })
    ).body;
    await s.json("PUT", `/api/projects/${mine.id}/members/${alice.id}`, { as: admin, body: {} });

    const r = await s.json<Pull>("GET", "/api/sync/pull?since=0", { as: alice.agent });
    const ids = (r.body.changes.projects ?? []).map((p) => p.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(secret.id);
    expect(r.body.changes.users?.map((u) => u.name)).toEqual(["Alice"]);
    const adminPull = await s.json<Pull>("GET", "/api/sync/pull?since=0", { as: admin });
    for (const rows of Object.values(adminPull.body.changes)) {
      for (const row of rows) {
        expect(Object.keys(row).filter((k) => /rate|billable|currency|amount/i.test(k))).toEqual([]);
      }
    }
  });

  test("the epoch changes when a member's visibility changes", async () => {
    const s = createTestServer();
    const admin = await s.setup();
    const alice = await s.createUser(admin, { email: "alice@example.com", name: "Alice" });
    const client = (await s.json<Client>("POST", "/api/clients", { as: admin, body: { name: "Acme" } })).body;
    const p = (
      await s.json<Project>("POST", "/api/projects", { as: admin, body: { clientId: client.id, name: "P" } })
    ).body;
    const before = (await s.json<Pull>("GET", "/api/sync/pull?since=0", { as: alice.agent })).body.epoch;
    await s.json("PUT", `/api/projects/${p.id}/members/${alice.id}`, { as: admin, body: {} });
    const after = (await s.json<Pull>("GET", "/api/sync/pull?since=0", { as: alice.agent })).body.epoch;
    expect(after).not.toBe(before);
  });

  test("managers receive the projects their team works on, and reset when their team changes", async () => {
    const s = createTestServer();
    const admin = await s.setup();
    const mgr = await s.createUser(admin, { email: "mgr@example.com", name: "Mandla", role: "manager" });
    const alice = await s.createUser(admin, { email: "alice@example.com", name: "Alice", managerId: mgr.id });
    const bob = await s.createUser(admin, { email: "bob@example.com", name: "Bob" });
    const client = (await s.json<Client>("POST", "/api/clients", { as: admin, body: { name: "Acme" } })).body;
    const mk = async (name: string) =>
      (await s.json<Project>("POST", "/api/projects", { as: admin, body: { clientId: client.id, name } }))
        .body;
    const alicesProject = await mk("Alice's project");
    const bobsProject = await mk("Bob's project");
    await s.json("PUT", `/api/projects/${bobsProject.id}/members/${bob.id}`, { as: admin, body: {} });

    const epoch0 = (await s.json<Pull>("GET", "/api/sync/pull?since=0", { as: mgr.agent })).body.epoch;
    await s.json("PUT", `/api/projects/${alicesProject.id}/members/${alice.id}`, { as: admin, body: {} });
    const r = await s.json<Pull>("GET", "/api/sync/pull?since=0", { as: mgr.agent });
    expect(r.body.epoch).not.toBe(epoch0);
    const names = (r.body.changes.projects ?? []).map((p) => p.name);
    expect(names).toContain("Alice's project");
    expect(names).not.toContain("Bob's project");
    expect(r.body.changes.clients?.map((c) => c.name)).toContain("Acme");

    // Bob joins Mandla's team: Mandla's copy must be rebuilt to include Bob's older work.
    const epoch1 = r.body.epoch;
    await s.json("PATCH", `/api/users/${bob.id}`, { as: admin, body: { managerId: mgr.id } });
    const r2 = await s.json<Pull>("GET", "/api/sync/pull?since=0", { as: mgr.agent });
    expect(r2.body.epoch).not.toBe(epoch1);
    expect((r2.body.changes.projects ?? []).map((p) => p.name)).toContain("Bob's project");
  });

  test("opening up, closing or moving a project makes every app resync the items under it", async () => {
    const s = createTestServer();
    const admin = await s.setup();
    const bob = await s.createUser(admin, { email: "bob@example.com", name: "Bob" });
    const client = (await s.json<Client>("POST", "/api/clients", { as: admin, body: { name: "Acme" } })).body;
    const make = async (body: Record<string, unknown>) =>
      (await s.json<Project>("POST", "/api/projects", { as: admin, body: { clientId: client.id, ...body } }))
        .body;
    const secret = await make({ name: "Secret" });
    const sub = await make({ name: "Secret sub", parentId: secret.id });
    await make({ name: "Secret task", parentId: sub.id, kind: "Task" });
    const open = await make({ name: "Open", visibility: "everyone" });
    const pull = async () => (await s.json<Pull>("GET", "/api/sync/pull?since=0", { as: bob.agent })).body;
    const names = (p: Pull) => (p.changes.projects ?? []).map((x) => x.name);

    const p0 = await pull();
    expect(names(p0)).not.toContain("Secret sub");

    await s.json("PATCH", `/api/projects/${secret.id}`, { as: admin, body: { visibility: "everyone" } });
    const p1 = await pull();
    expect(p1.epoch).not.toBe(p0.epoch);
    expect(names(p1)).toEqual(expect.arrayContaining(["Secret", "Secret sub", "Secret task"]));

    await s.json("PATCH", `/api/projects/${secret.id}`, { as: admin, body: { visibility: "members" } });
    const p2 = await pull();
    expect(p2.epoch).not.toBe(p1.epoch);
    expect(names(p2)).not.toContain("Secret sub");

    // Moving the item under an open project opens it (and everything under it) up for Bob.
    await s.json("POST", `/api/projects/${sub.id}/move`, { as: admin, body: { parentId: open.id } });
    const p3 = await pull();
    expect(p3.epoch).not.toBe(p2.epoch);
    expect(names(p3)).toEqual(expect.arrayContaining(["Secret sub", "Secret task"]));

    // A plain reorder or rename doesn't force everyone to resync.
    await s.json("POST", `/api/projects/${sub.id}/move`, {
      as: admin,
      body: { parentId: open.id, sortOrder: 5 },
    });
    await s.json("PATCH", `/api/projects/${open.id}`, { as: admin, body: { name: "Open (renamed)" } });
    expect((await pull()).epoch).toBe(p3.epoch);
  });

  test("requires sign-in", async () => {
    const s = createTestServer();
    await s.setup();
    expect((await s.json("GET", "/api/sync/pull")).status).toBe(401);
  });
});
