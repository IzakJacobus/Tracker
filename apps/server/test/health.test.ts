import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBackup } from "../src/services/backup.ts";
import { checkForUpdate, compareVersions, storedUpdateInfo } from "../src/services/updates.ts";
import { createTestServer } from "./helpers.ts";

type Health = {
  status: string;
  checks: {
    id: string;
    status: string;
    fix?: { action: string; label: string; args?: Record<string, string> };
  }[];
  connected: { name: string; kind: string }[];
  pairing: { code: string | null };
};

function server() {
  const t = createTestServer();
  t.ctx.config = { ...t.ctx.config, dataDir: mkdtempSync(join(tmpdir(), "stint-health-")) };
  t.ctx.runtime.addresses = ["192.168.1.20"];
  t.ctx.runtime.caFingerprint = "q0vK3x8o8C5V7m3V7c2J4YbqTjWZ1o7XwUQnN0xqQ1Y";
  return t;
}

describe("health", () => {
  test("is admin-only and reports backups, connected people and the pairing code", async () => {
    const t = server();
    const admin = await t.setup();
    const { agent: member } = await t.createUser(admin, {
      name: "Aisha",
      email: "aisha@example.co.za",
      role: "member",
    });
    expect((await t.json("GET", "/api/admin/health", { as: member })).status).toBe(403);

    const h = await t.json<Health>("GET", "/api/admin/health", { as: admin });
    expect(h.status).toBe(200);
    const backup = h.body.checks.find((c) => c.id === "backup");
    expect(backup).toMatchObject({ status: "warning", fix: { action: "backup_now" } });
    expect(h.body.checks.find((c) => c.id === "backup_location")?.status).toBe("warning");
    expect(h.body.status).toBe("warning");
    expect(h.body.connected.map((c) => c.name).sort()).toEqual(["Aisha", "Thandi Admin"]);
    expect(h.body.pairing.code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  });

  test("a recent successful backup turns the backup check green", async () => {
    const t = server();
    const admin = await t.setup();
    expect(runBackup(t.ctx, "manual").ok).toBe(true);
    const h = await t.json<Health>("GET", "/api/admin/health", { as: admin });
    expect(h.body.checks.find((c) => c.id === "backup")?.status).toBe("ok");
    t.clock.advance(3 * 86_400_000);
    const later = await t.json<Health>("GET", "/api/admin/health", { as: admin });
    expect(later.body.checks.find((c) => c.id === "backup")?.status).toBe("warning");
  });

  test("a Public network shows a warning with a one-click fix", async () => {
    const t = server();
    const admin = await t.setup();
    t.ctx.runtime.networkWarning = 'Windows treats the network "Office" as Public…';
    t.ctx.runtime.platform = {
      checkedAt: t.clock.now,
      sleepGuard: { active: true, method: "SetThreadExecutionState" },
      networks: [{ name: "Office", interfaceAlias: "Ethernet", category: "Public" }],
      firewall: { checked: true, rules: [] },
      tailscale: { installed: false, running: false, dnsName: null, ips: [] },
    };
    let changed = "";
    t.ctx.services.makeNetworkPrivate = async (alias) => {
      changed = alias;
      return true;
    };
    const h = await t.json<Health>("GET", "/api/admin/health", { as: admin });
    expect(h.body.checks.find((c) => c.id === "network")?.fix).toEqual({
      action: "make_private",
      label: "Mark as Private",
      args: { interfaceAlias: "Ethernet" },
    });
    expect(h.body.checks.find((c) => c.id === "firewall")?.status).toBe("error");
    expect(h.body.status).toBe("error");

    const unknown = await t.json("POST", "/api/admin/network/private", {
      as: admin,
      body: { interfaceAlias: "Wi-Fi" },
    });
    expect(unknown.status).toBe(404);
    const ok = await t.json("POST", "/api/admin/network/private", {
      as: admin,
      body: { interfaceAlias: "Ethernet" },
    });
    expect(ok.status).toBe(200);
    expect(changed).toBe("Ethernet");
  });
});

describe("server info", () => {
  test("lists the addresses the server answers on, plus Tailscale when remote access is on", async () => {
    const t = server();
    const admin = await t.setup();
    const info = async () => (await t.json<{ reachableAt: string[] }>("GET", "/api/info")).body.reachableAt;
    expect(await info()).toEqual(["192.168.1.20:47600"]);
    t.ctx.runtime.platform = {
      checkedAt: t.clock.now,
      sleepGuard: { active: true, method: null },
      networks: [],
      firewall: { checked: false, rules: [] },
      tailscale: {
        installed: true,
        running: true,
        dnsName: "office-pc.tail1234.ts.net",
        ips: ["100.101.102.103"],
      },
    };
    expect(await info()).toEqual(["192.168.1.20:47600"]);
    await t.json("PATCH", "/api/org", {
      as: admin,
      body: { settings: { remoteAccess: { enabled: true, provider: "tailscale" } } },
    });
    expect(await info()).toEqual(["192.168.1.20:47600", "office-pc.tail1234.ts.net:47600"]);
  });
});

describe("update check", () => {
  test("compares versions like people expect", () => {
    expect(compareVersions("1.2.10", "1.2.9")).toBe(1);
    expect(compareVersions("v1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0-beta.2", "1.0.0")).toBe(-1);
    expect(compareVersions("1.0.0", "1.0.0-rc.1")).toBe(1);
    expect(compareVersions("0.9", "0.10.0")).toBe(-1);
  });

  test("reads the latest GitHub release and remembers it", async () => {
    const t = server();
    t.ctx.version = "0.9.0";
    let url = "";
    const fake = (async (input: string | URL | Request) => {
      url = String(input);
      return Response.json({
        tag_name: "v1.0.0",
        html_url: "https://github.com/IzakJacobus/Tracker/releases/tag/v1.0.0",
        body: "First release",
        published_at: "2026-10-01T08:00:00Z",
      });
    }) as typeof fetch;
    const info = await checkForUpdate(t.ctx, fake);
    expect(url).toBe("https://api.github.com/repos/IzakJacobus/Tracker/releases/latest");
    expect(info).toMatchObject({ latest: "1.0.0", available: true, notes: "First release" });
    t.ctx.version = "1.0.0";
    expect(storedUpdateInfo(t.ctx)?.available).toBe(false);
  });

  test("a failed check keeps the last answer and records the error", async () => {
    const t = server();
    t.ctx.version = "0.9.0";
    const ok = (async () => Response.json({ tag_name: "v1.0.0", html_url: "x" })) as unknown as typeof fetch;
    await checkForUpdate(t.ctx, ok);
    const down = (async () => {
      throw new Error("getaddrinfo ENOTFOUND api.github.com");
    }) as unknown as typeof fetch;
    const info = await checkForUpdate(t.ctx, down);
    expect(info.latest).toBe("1.0.0");
    expect(info.error).toContain("ENOTFOUND");
  });
});
