import { describe, expect, test } from "bun:test";
import type { Client, Project } from "@stint/shared";
import { createTestServer } from "./helpers.ts";

interface Pull {
  changes: Record<string, { id: string; rate?: number | null; name?: string; deletedAt?: number | null }[]>;
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
    expect(full.body.changes.projects?.length).toBe(5);
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

  test("members only receive what they may see, without money", async () => {
    const s = createTestServer();
    const admin = await s.setup();
    const alice = await s.createUser(admin, { email: "alice@example.com", name: "Alice", rate: 70000 });
    await s.createUser(admin, { email: "bob@example.com", name: "Bob" });
    const client = (
      await s.json<Client>("POST", "/api/clients", { as: admin, body: { name: "Acme", rate: 90000 } })
    ).body;
    const secret = (
      await s.json<Project>("POST", "/api/projects", {
        as: admin,
        body: { clientId: client.id, name: "Secret", rate: 1 },
      })
    ).body;
    const mine = (
      await s.json<Project>("POST", "/api/projects", {
        as: admin,
        body: { clientId: client.id, name: "Mine", rate: 99 },
      })
    ).body;
    await s.json("PUT", `/api/projects/${mine.id}/members/${alice.id}`, { as: admin, body: { rate: 12345 } });

    const r = await s.json<Pull>("GET", "/api/sync/pull?since=0", { as: alice.agent });
    const ids = (r.body.changes.projects ?? []).map((p) => p.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(secret.id);
    expect(r.body.changes.users?.map((u) => u.name)).toEqual(["Alice"]);
    expect(r.body.changes.users?.[0]?.rate).toBeNull();
    for (const table of ["projects", "clients", "projectMembers"]) {
      for (const row of r.body.changes[table] ?? []) expect(row.rate ?? null).toBeNull();
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

  test("requires sign-in", async () => {
    const s = createTestServer();
    await s.setup();
    expect((await s.json("GET", "/api/sync/pull")).status).toBe(401);
  });
});
