import { createApp } from "../src/app.ts";
import { LoginLimiter } from "../src/auth/rateLimit.ts";
import { ConfigSchema } from "../src/config.ts";
import type { AppContext } from "../src/context.ts";
import { migrate } from "../src/db/migrate.ts";
import { migrations } from "../src/db/migrations/index.ts";
import { openDatabase } from "../src/db/open.ts";
import { silentLogger } from "../src/lib/log.ts";
import { setMeta } from "../src/lib/meta.ts";

export const ADMIN = {
  name: "Thandi Admin",
  email: "admin@example.co.za",
  password: "correct horse battery",
};

export interface TestServer {
  ctx: AppContext;
  clock: { now: number; advance(ms: number): void };
  request(
    method: string,
    path: string,
    opts?: { body?: unknown; as?: Agent; ip?: string; loopback?: boolean; headers?: Record<string, string> },
  ): Promise<Response>;
  json<T = unknown>(
    method: string,
    path: string,
    opts?: { body?: unknown; as?: Agent; ip?: string; loopback?: boolean },
  ): Promise<{ status: number; body: T }>;
  agent(): Agent;
  setup(): Promise<Agent>;
  login(email: string, password: string): Promise<Agent>;
  createUser(admin: Agent, input: Record<string, unknown>): Promise<{ id: string; agent: Agent }>;
}

export interface Agent {
  cookie: string | null;
}

export function createTestServer(start = Date.UTC(2026, 8, 30, 8, 0)): TestServer {
  const db = openDatabase(":memory:");
  migrate(db, migrations);
  setMeta(db, "server_id", "00000000-0000-7000-8000-000000000001");
  const clock = {
    now: start,
    advance(ms: number) {
      clock.now += ms;
    },
  };
  const ctx: AppContext = {
    db,
    config: ConfigSchema.parse({ dataDir: "/tmp/stint-test" }),
    log: silentLogger,
    now: () => clock.now,
    version: "0.0.0-test",
    limiter: new LoginLimiter(() => clock.now),
    runtime: {
      startedAt: start,
      httpsPort: 47600,
      httpPort: 47601,
      addresses: [],
      hostname: "test",
      caFingerprint: null,
    },
    services: {},
  };
  const app = createApp(ctx);

  const request: TestServer["request"] = async (method, path, opts = {}) => {
    const headers: Record<string, string> = { "x-stint-request": "1", ...(opts.headers ?? {}) };
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    if (opts.as?.cookie) headers.cookie = opts.as.cookie;
    const res = await app.request(
      path,
      { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) },
      { ip: opts.ip ?? "192.168.1.50", loopback: opts.loopback ?? false },
    );
    const set = res.headers.get("set-cookie");
    if (set && opts.as) {
      const m = /stint_session=([^;]*)/.exec(set);
      if (m) opts.as.cookie = m[1] ? `stint_session=${m[1]}` : null;
    }
    return res;
  };

  const json: TestServer["json"] = async (method, path, opts) => {
    const res = await request(method, path, opts);
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as never };
  };

  const server: TestServer = {
    ctx,
    clock,
    request,
    json,
    agent: () => ({ cookie: null }),
    async setup() {
      const a: Agent = { cookie: null };
      const r = await json("POST", "/api/setup", {
        as: a,
        loopback: true,
        ip: "127.0.0.1",
        body: { organizationName: "Karoo Consulting Engineers", admin: ADMIN },
      });
      if (r.status !== 201) throw new Error(`setup failed: ${JSON.stringify(r.body)}`);
      return a;
    },
    async login(email, password) {
      const a: Agent = { cookie: null };
      const r = await json("POST", "/api/auth/login", { as: a, body: { email, password } });
      if (r.status !== 200) throw new Error(`login failed: ${JSON.stringify(r.body)}`);
      return a;
    },
    async createUser(admin, input) {
      const password = (input.password as string) ?? "member password 1";
      const r = await json<{ id: string }>("POST", "/api/users", { as: admin, body: { password, ...input } });
      if (r.status !== 201) throw new Error(`create user failed: ${JSON.stringify(r.body)}`);
      // New people must replace the admin's temporary password before using anything else.
      const agent = await server.login(String(input.email), password);
      const changed = await json("POST", "/api/auth/password", {
        as: agent,
        body: { currentPassword: password, newPassword: password },
      });
      if (changed.status !== 200) throw new Error(`password change failed: ${JSON.stringify(changed.body)}`);
      return { id: r.body.id, agent };
    },
  };
  return server;
}
