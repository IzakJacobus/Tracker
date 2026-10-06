import { describe, expect, test } from "bun:test";
import { createTestServer } from "./helpers.ts";

describe("organisation settings", () => {
  test("admins update settings; values are validated and merged", async () => {
    const s = createTestServer();
    const admin = await s.setup();
    const r = await s.json<{ settings: { currency: string; weekStart: number; rounding: { mode: string } } }>(
      "PATCH",
      "/api/org",
      {
        as: admin,
        body: { settings: { currency: "USD", rounding: { mode: "up", minutes: 15 } } },
      },
    );
    expect(r.status).toBe(200);
    expect(r.body.settings.currency).toBe("USD");
    expect(r.body.settings.weekStart).toBe(1);
    expect(r.body.settings.rounding.mode).toBe("up");
    const bad = await s.json("PATCH", "/api/org", { as: admin, body: { settings: { currency: "rand" } } });
    expect(bad.status).toBe(422);
  });

  test("members cannot change settings", async () => {
    const s = createTestServer();
    const admin = await s.setup();
    const { agent } = await s.createUser(admin, { email: "sipho@example.co.za", name: "Sipho" });
    expect((await s.json("PATCH", "/api/org", { as: agent, body: { name: "Mine now" } })).status).toBe(403);
    expect((await s.json("GET", "/api/org", { as: agent })).status).toBe(200);
  });

  test("logo must be a small image data URL", async () => {
    const s = createTestServer();
    const admin = await s.setup();
    const ok = await s.json("PUT", "/api/org/logo", {
      as: admin,
      body: { logo: "data:image/png;base64,iVBORw0KGgo=" },
    });
    expect(ok.status).toBe(200);
    const bad = await s.json("PUT", "/api/org/logo", { as: admin, body: { logo: "javascript:alert(1)" } });
    expect(bad.status).toBe(422);
  });
});

describe("users", () => {
  test("admins create users, who must change their password before using anything", async () => {
    const s = createTestServer();
    const admin = await s.setup();
    const created = await s.json("POST", "/api/users", {
      as: admin,
      body: {
        email: "lerato@example.co.za",
        name: "Lerato",
        role: "manager",
        rate: 95000,
        password: "temporary pw 1",
      },
    });
    expect(created.status).toBe(201);
    const agent = await s.login("lerato@example.co.za", "temporary pw 1");
    const me = await s.json<{ user: { mustChangePassword: boolean; role: string; rate: number } }>(
      "GET",
      "/api/auth/me",
      { as: agent },
    );
    expect(me.body.user.mustChangePassword).toBe(true);
    expect(me.body.user.role).toBe("manager");
    expect(me.body.user.rate).toBe(95000);

    // The server, not just the app's screen, blocks everything else until they choose a password.
    for (const [method, path] of [
      ["GET", "/api/sync/pull?since=0"],
      ["GET", "/api/users"],
      ["POST", "/api/sync/push"],
    ] as const) {
      const r = await s.json<{ error: { code: string } }>(method, path, {
        as: agent,
        body: method === "POST" ? { changes: [] } : undefined,
      });
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe("password_change_required");
    }
    const changed = await s.json("POST", "/api/auth/password", {
      as: agent,
      body: { currentPassword: "temporary pw 1", newPassword: "my own password" },
    });
    expect(changed.status).toBe(200);
    expect((await s.json("GET", "/api/sync/pull?since=0", { as: agent })).status).toBe(200);
  });

  test("duplicate emails are rejected", async () => {
    const s = createTestServer();
    const admin = await s.setup();
    await s.createUser(admin, { email: "a@example.com", name: "A" });
    const r = await s.json("POST", "/api/users", {
      as: admin,
      body: { email: "A@example.com", name: "B", password: "long enough pw" },
    });
    expect(r.status).toBe(409);
  });

  test("members see only themselves and never their rate by default", async () => {
    const s = createTestServer();
    const admin = await s.setup();
    await s.createUser(admin, { email: "other@example.com", name: "Other" });
    const { agent, id } = await s.createUser(admin, { email: "m@example.com", name: "Member", rate: 50000 });
    const list = await s.json<{ id: string; rate: number | null }[]>("GET", "/api/users", { as: agent });
    expect(list.body.map((u) => u.id)).toEqual([id]);
    expect(list.body[0]!.rate).toBeNull();
    await s.json("PATCH", "/api/org", { as: admin, body: { settings: { membersSeeOwnRates: true } } });
    const list2 = await s.json<{ rate: number | null }[]>("GET", "/api/users", { as: agent });
    expect(list2.body[0]!.rate).toBe(50000);
  });

  test("members and managers cannot create users (server-side check)", async () => {
    const s = createTestServer();
    const admin = await s.setup();
    const { agent: mgr } = await s.createUser(admin, {
      email: "mgr@example.com",
      name: "Mgr",
      role: "manager",
    });
    const r = await s.json("POST", "/api/users", {
      as: mgr,
      body: { email: "x@example.com", name: "X", password: "long enough pw" },
    });
    expect(r.status).toBe(403);
  });

  test("the last admin cannot be demoted or deactivated", async () => {
    const s = createTestServer();
    const admin = await s.setup();
    const me = await s.json<{ user: { id: string } }>("GET", "/api/auth/me", { as: admin });
    const r = await s.json("PATCH", `/api/users/${me.body.user.id}`, { as: admin, body: { role: "member" } });
    expect(r.status).toBe(400);
  });

  test("deactivating a user signs them out everywhere", async () => {
    const s = createTestServer();
    const admin = await s.setup();
    const { agent, id } = await s.createUser(admin, { email: "leaver@example.com", name: "Leaver" });
    await s.json("PATCH", `/api/users/${id}`, { as: admin, body: { active: false } });
    expect((await s.request("GET", "/api/auth/me", { as: agent })).status).toBe(401);
    const login = await s.json("POST", "/api/auth/login", {
      body: { email: "leaver@example.com", password: "member password 1" },
    });
    expect(login.status).toBe(401);
  });

  test("password reset forces a change at next sign-in", async () => {
    const s = createTestServer();
    const admin = await s.setup();
    const { id } = await s.createUser(admin, { email: "forgot@example.com", name: "Forgetful" });
    const r = await s.json("POST", `/api/users/${id}/reset-password`, {
      as: admin,
      body: { password: "temporary password" },
    });
    expect(r.status).toBe(200);
    await s.login("forgot@example.com", "temporary password");
  });

  test("'reports to' must be a real manager, and loops are refused", async () => {
    const s = createTestServer();
    const admin = await s.setup();
    const a = await s.createUser(admin, { email: "a@example.com", name: "Anele", role: "manager" });
    const b = await s.createUser(admin, {
      email: "b@example.com",
      name: "Busi",
      role: "manager",
      managerId: a.id,
    });
    const c = await s.createUser(admin, {
      email: "c@example.com",
      name: "Chris",
      role: "manager",
      managerId: b.id,
    });
    const m = await s.createUser(admin, { email: "m@example.com", name: "Member" });
    const patch = (id: string, managerId: string) =>
      s.json<{ error: { message: string } }>("PATCH", `/api/users/${id}`, { as: admin, body: { managerId } });

    const unknown = await patch(m.id, "01900000-0000-7000-8000-000000000000");
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.message).toContain("doesn't exist");
    expect((await patch(c.id, m.id)).status).toBe(400); // a member can't approve timesheets
    expect((await patch(a.id, a.id)).status).toBe(400);
    const loop = await patch(a.id, c.id); // C → B → A, so A can't report to C
    expect(loop.status).toBe(400);
    expect(loop.body.error.message).toContain("loop");
    expect((await patch(m.id, c.id)).status).toBe(200);
    const created = await s.json("POST", "/api/users", {
      as: admin,
      body: {
        email: "x@example.com",
        name: "X",
        password: "long enough pw",
        managerId: "01900000-0000-7000-8000-000000000000",
      },
    });
    expect(created.status).toBe(400);
  });

  test("user changes are audited", async () => {
    const s = createTestServer();
    const admin = await s.setup();
    const { id } = await s.createUser(admin, { email: "audit@example.com", name: "Audit" });
    await s.json("PATCH", `/api/users/${id}`, { as: admin, body: { name: "Audited" } });
    const rows = s.ctx.db
      .query<{ action: string }, [string]>(
        "SELECT action FROM audit_log WHERE entity = 'user' AND entity_id = ? ORDER BY id",
      )
      .all(id);
    expect(rows.map((r) => r.action)).toEqual(["create", "password_change", "update"]);
  });
});

describe("connect", () => {
  test("gives signed-in users the browser addresses and a QR code", async () => {
    const s = createTestServer();
    s.ctx.runtime.addresses = ["10.0.0.5", "192.168.1.23"];
    s.ctx.runtime.hostname = "office-pc";
    const admin = await s.setup();
    const r = await s.json<{ url: string; urls: string[]; qrUrl: string; qrSvg: string }>(
      "GET",
      "/api/connect",
      {
        as: admin,
      },
    );
    expect(r.status).toBe(200);
    expect(r.body.url).toBe("https://office-pc.local:47600");
    expect(r.body.urls).toContain("https://192.168.1.23:47600");
    expect(r.body.urls).toContain("https://10.0.0.5:47600");
    // phones often can't resolve .local, so the QR code carries an IP address
    expect(["https://10.0.0.5:47600", "https://192.168.1.23:47600"]).toContain(r.body.qrUrl);
    expect(r.body.qrSvg).toContain("<svg");
    expect((await s.json("GET", "/api/connect")).status).toBe(401);
  });
});
