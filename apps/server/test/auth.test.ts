import { describe, expect, test } from "bun:test";
import { ADMIN, createTestServer } from "./helpers.ts";

describe("setup", () => {
  test("reports not set up, then sets up from the server PC", async () => {
    const s = createTestServer();
    const st = await s.json<{ setupComplete: boolean }>("GET", "/api/setup/status");
    expect(st.body.setupComplete).toBe(false);
    const admin = await s.setup();
    expect(admin.cookie).toBeTruthy();
    const me = await s.json<{
      user: { role: string; email: string };
      organization: {
        name: string;
        settings: { currency: string; timezone: string; weekStart: number; dateFormat: string };
      };
    }>("GET", "/api/auth/me", { as: admin });
    expect(me.status).toBe(200);
    expect(me.body.user.role).toBe("admin");
    expect(me.body.organization.name).toBe("Karoo Consulting Engineers");
    // South African defaults
    expect(me.body.organization.settings.currency).toBe("ZAR");
    expect(me.body.organization.settings.timezone).toBe("Africa/Johannesburg");
    expect(me.body.organization.settings.weekStart).toBe(1);
    expect(me.body.organization.settings.dateFormat).toBe("YYYY-MM-DD");
  });

  test("creates the built-in Internal client with internal projects", async () => {
    const s = createTestServer();
    await s.setup();
    const clients = s.ctx.db
      .query<{ name: string; is_internal: number }, []>("SELECT name, is_internal FROM clients")
      .all();
    expect(clients).toEqual([{ name: "Internal", is_internal: 1 }]);
    const projects = s.ctx.db
      .query<{ name: string; billable_default: number; visibility: string }, []>(
        "SELECT name, billable_default, visibility FROM projects ORDER BY sort_order",
      )
      .all();
    expect(projects.map((p) => p.name)).toContain("Leave");
    expect(projects.every((p) => p.billable_default === 0 && p.visibility === "everyone")).toBe(true);
  });

  test("is refused from another computer on the network", async () => {
    const s = createTestServer();
    const r = await s.json<{ error: { code: string } }>("POST", "/api/setup", {
      loopback: false,
      body: { organizationName: "Evil Corp", admin: ADMIN },
    });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("setup_local_only");
  });

  test("cannot run twice", async () => {
    const s = createTestServer();
    await s.setup();
    const r = await s.json("POST", "/api/setup", {
      loopback: true,
      body: { organizationName: "Again", admin: { ...ADMIN, email: "x@y.co" } },
    });
    expect(r.status).toBe(409);
  });

  test("validates input with helpful messages", async () => {
    const s = createTestServer();
    const r = await s.json<{ error: { code: string; details: { fields: Record<string, string> } } }>(
      "POST",
      "/api/setup",
      {
        loopback: true,
        body: { organizationName: "", admin: { name: "A", email: "not-an-email", password: "short" } },
      },
    );
    expect(r.status).toBe(422);
    expect(Object.keys(r.body.error.details.fields)).toEqual(
      expect.arrayContaining(["organizationName", "admin.email", "admin.password"]),
    );
  });
});

describe("login", () => {
  test("sets an httpOnly, Secure, SameSite=Strict cookie", async () => {
    const s = createTestServer();
    await s.setup();
    const res = await s.request("POST", "/api/auth/login", {
      body: { email: ADMIN.email, password: ADMIN.password },
    });
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
  });

  test("email is case-insensitive", async () => {
    const s = createTestServer();
    await s.setup();
    await s.login(ADMIN.email.toUpperCase(), ADMIN.password);
  });

  test("desktop clients get a bearer token instead of a cookie", async () => {
    const s = createTestServer();
    await s.setup();
    const res = await s.request("POST", "/api/auth/login", {
      body: { email: ADMIN.email, password: ADMIN.password },
      headers: { "x-stint-client": "desktop" },
    });
    const b = (await res.json()) as { token: string };
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(b.token.length).toBeGreaterThan(30);
    const me = await s.request("GET", "/api/auth/me", { headers: { authorization: `Bearer ${b.token}` } });
    expect(me.status).toBe(200);
  });

  test("wrong password is rejected without revealing which part was wrong", async () => {
    const s = createTestServer();
    await s.setup();
    const a = await s.json<{ error: { message: string } }>("POST", "/api/auth/login", {
      body: { email: ADMIN.email, password: "nope" },
    });
    const b = await s.json<{ error: { message: string } }>("POST", "/api/auth/login", {
      body: { email: "ghost@example.com", password: "nope" },
    });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error.message).toBe(b.body.error.message);
  });

  test("is rate-limited after 5 failures, per account and IP, and recovers", async () => {
    const s = createTestServer();
    await s.setup();
    for (let i = 0; i < 5; i++) {
      await s.json("POST", "/api/auth/login", { body: { email: ADMIN.email, password: "wrong" } });
    }
    const blocked = await s.request("POST", "/api/auth/login", {
      body: { email: ADMIN.email, password: ADMIN.password },
    });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    // A different computer is not blocked
    const other = await s.request("POST", "/api/auth/login", {
      ip: "192.168.1.77",
      body: { email: ADMIN.email, password: ADMIN.password },
    });
    expect(other.status).toBe(200);
    s.clock.advance(16 * 60_000);
    const later = await s.request("POST", "/api/auth/login", {
      body: { email: ADMIN.email, password: ADMIN.password },
    });
    expect(later.status).toBe(200);
  });

  test("logout ends the session", async () => {
    const s = createTestServer();
    const admin = await s.setup();
    const saved = admin.cookie;
    await s.json("POST", "/api/auth/logout", { as: admin });
    const me = await s.request("GET", "/api/auth/me", { as: { cookie: saved } });
    expect(me.status).toBe(401);
  });

  test("sessions expire after 30 days of inactivity", async () => {
    const s = createTestServer();
    const admin = await s.setup();
    s.clock.advance(31 * 24 * 3600_000);
    expect((await s.request("GET", "/api/auth/me", { as: admin })).status).toBe(401);
  });

  test("state-changing requests need the CSRF header", async () => {
    const s = createTestServer();
    await s.setup();
    const res = await s.request("POST", "/api/auth/login", {
      body: { email: ADMIN.email, password: ADMIN.password },
      headers: { "x-stint-request": "0" },
    });
    expect(res.status).toBe(403);
  });

  test("audits logins and failures", async () => {
    const s = createTestServer();
    await s.setup();
    await s.json("POST", "/api/auth/login", { body: { email: ADMIN.email, password: "wrong" } });
    await s.login(ADMIN.email, ADMIN.password);
    const actions = s.ctx.db
      .query<{ action: string }, []>("SELECT action FROM audit_log ORDER BY id")
      .all()
      .map((r) => r.action);
    expect(actions).toEqual(["setup", "login_failed", "login"]);
  });
});

describe("password change", () => {
  test("requires the current password and signs out other sessions", async () => {
    const s = createTestServer();
    const a1 = await s.setup();
    const a2 = await s.login(ADMIN.email, ADMIN.password);
    const bad = await s.json("POST", "/api/auth/password", {
      as: a1,
      body: { currentPassword: "nope", newPassword: "a brand new password" },
    });
    expect(bad.status).toBe(400);
    const ok = await s.json("POST", "/api/auth/password", {
      as: a1,
      body: { currentPassword: ADMIN.password, newPassword: "a brand new password" },
    });
    expect(ok.status).toBe(200);
    expect((await s.request("GET", "/api/auth/me", { as: a1 })).status).toBe(200);
    expect((await s.request("GET", "/api/auth/me", { as: a2 })).status).toBe(401);
    await s.login(ADMIN.email, "a brand new password");
  });
});
