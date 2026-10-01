import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigSchema } from "../src/config.ts";
import { silentLogger } from "../src/lib/log.ts";
import { isLocalRequest, isLoopbackHostname } from "../src/net/addresses.ts";
import { type RunningServer, startServer } from "../src/server.ts";

describe("local requests", () => {
  test("only loopback connections to a loopback host name count as the server PC", () => {
    expect(isLocalRequest("127.0.0.1", "localhost")).toBe(true);
    expect(isLocalRequest("::1", "[::1]")).toBe(true);
    expect(isLocalRequest("127.0.0.1", "127.0.0.1")).toBe(true);
    // DNS rebinding: the attacker's name pointed at 127.0.0.1.
    expect(isLocalRequest("127.0.0.1", "rebind.attacker.example")).toBe(false);
    // A tunnel on the same PC forwarding an internet visitor.
    expect(isLocalRequest("127.0.0.1", "stint.yourfirm.co.za")).toBe(false);
    expect(isLocalRequest("192.168.1.50", "localhost")).toBe(false);
    expect(isLoopbackHostname("127.evil.example")).toBe(false);
  });
});

describe("first-run setup over a rebound host name", () => {
  let server: RunningServer;
  let dir: string;
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "stint-local-"));
    const config = ConfigSchema.parse({
      dataDir: dir,
      port: 47860,
      httpPort: 47861,
      discovery: false,
      sleepGuard: false,
      updateCheck: false,
      openBrowser: false,
    });
    server = await startServer(config, { version: "0.0.0-test", log: silentLogger });
  });
  afterAll(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  const setup = (host: string) =>
    fetch(`http://127.0.0.1:${server.http.port}/api/setup`, {
      method: "POST",
      redirect: "manual",
      headers: { host, "content-type": "application/json", "x-stint-request": "1" },
      body: JSON.stringify({
        organizationName: "Attacker Ltd",
        admin: { name: "Mallory", email: "m@attacker.example", password: "attacker password" },
      }),
    });

  test("a page whose domain was rebound to 127.0.0.1 can't claim the server", async () => {
    const r = await setup(`rebind.attacker.example:${server.http.port}`);
    // Not local, so plain HTTP only redirects to HTTPS; setup never runs.
    expect(r.status).toBe(302);
    const status = (await (
      await fetch(`http://127.0.0.1:${server.http.port}/api/setup/status`, {
        headers: { host: `localhost:${server.http.port}` },
      })
    ).json()) as { setupComplete: boolean; fromServerPc: boolean };
    expect(status).toEqual({ setupComplete: false, fromServerPc: true });
  });

  test("over HTTPS from a tunnel (loopback IP, public host name) setup is refused too", async () => {
    const r = await fetch(`https://127.0.0.1:${server.https.port}/api/setup`, {
      method: "POST",
      headers: { host: "stint.yourfirm.co.za", "content-type": "application/json", "x-stint-request": "1" },
      body: JSON.stringify({
        organizationName: "Attacker Ltd",
        admin: { name: "Mallory", email: "m@attacker.example", password: "attacker password" },
      }),
      tls: { rejectUnauthorized: false },
    });
    expect(r.status).toBe(403);
  });

  test("the person at the server PC can still set it up", async () => {
    const r = await setup(`localhost:${server.http.port}`);
    expect(r.status).toBe(201);
  });
});
