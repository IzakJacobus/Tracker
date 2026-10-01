import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { uuidv7 } from "@stint/shared";
import type { Server } from "bun";
import { createApp } from "./app.ts";
import { LoginLimiter } from "./auth/rateLimit.ts";
import { pruneSessions } from "./auth/sessions.ts";
import type { ServerConfig } from "./config.ts";
import type { AppContext } from "./context.ts";
import { appliedMigrations, migrate } from "./db/migrate.ts";
import { migrations } from "./db/migrations/index.ts";
import { openDatabase } from "./db/open.ts";
import { createLogger, type Logger } from "./lib/log.ts";
import { getMeta, setMeta } from "./lib/meta.ts";
import { isLoopback, lanAddresses, machineName } from "./net/addresses.ts";
import { startDiscovery } from "./net/discovery.ts";
import { listenWithFallback } from "./net/listen.ts";
import { ensureTls } from "./net/tls.ts";
import { makeNetworkPrivate } from "./platform/network.ts";
import { createSleepGuard } from "./platform/sleep.ts";
import { tailscaleStatus } from "./platform/tailscale.ts";
import { runBackup, startBackupScheduler } from "./services/backup.ts";
import { getOrgRow, getOrgSettings } from "./services/org.ts";
import { startPlatformMonitor } from "./services/platformMonitor.ts";
import { startUpdateChecks } from "./services/updates.ts";
import { emptySource, folderSource, type StaticSource, serveStatic } from "./web/static.ts";

export interface RunningServer {
  ctx: AppContext;
  https: Server<unknown>;
  http: Server<unknown>;
  adminUrl: string;
  stop(): Promise<void>;
}

export interface StartOptions {
  version: string;
  web?: StaticSource;
  log?: Logger;
  /** Provided when running as a service: exit so the service manager starts us again. */
  requestRestart?: () => void;
}

export interface RuntimeFile {
  pid: number;
  version: string;
  httpsPort: number;
  httpPort: number;
  startedAt: number;
  adminUrl: string;
}

/** In its own folder so the installer can let ordinary users read it (the rest of the data folder is admin-only). */
export const runtimeFilePath = (dataDir: string) => join(dataDir, "run", "runtime.json");

export async function startServer(config: ServerConfig, opts: StartOptions): Promise<RunningServer> {
  if (!existsSync(config.dataDir)) mkdirSync(config.dataDir, { recursive: true });
  const log = opts.log ?? createLogger(config.logLevel, join(config.dataDir, "logs"));
  const dbPath = join(config.dataDir, "stint.db");
  const db = openDatabase(dbPath);
  const result = migrate(db, migrations, {
    // Upgrades never touch data without a copy to go back to.
    beforeApply: () => {
      if (!appliedMigrations(db).length || !getOrgRow(db)) return;
      const r = runBackup({ db, config, log, now: Date.now }, "pre-migration");
      if (!r.ok) throw new Error(`Could not back up before upgrading the database: ${r.error}`);
    },
  });
  if (result.applied.length) log.info("Database migrated", { applied: result.applied });
  if (!getMeta(db, "server_id")) setMeta(db, "server_id", uuidv7());

  const hostname = machineName();
  const addresses = lanAddresses();
  const org = getOrgRow(db);
  // With remote access on, the certificate also covers the Tailscale name (office-pc.tailnet.ts.net).
  const tailscale = getOrgSettings(db).remoteAccess.enabled ? await tailscaleStatus() : null;
  const tls = await ensureTls(
    db,
    {
      dns: ["localhost", hostname, `${hostname}.local`, ...(tailscale?.dnsName ? [tailscale.dnsName] : [])],
      ips: ["127.0.0.1", ...addresses],
    },
    org?.name ?? "",
  );

  const ctx: AppContext = {
    db,
    config,
    log,
    now: Date.now,
    version: opts.version,
    limiter: new LoginLimiter(),
    runtime: {
      startedAt: Date.now(),
      httpsPort: null,
      httpPort: null,
      addresses,
      hostname,
      caFingerprint: tls.caFingerprint,
      certificateExpiresAt: tls.leafNotAfter,
    },
    services: { requestRestart: opts.requestRestart, makeNetworkPrivate },
  };
  const platform = startPlatformMonitor(ctx, createSleepGuard(log));
  ctx.services.refreshPlatform = platform.refresh;
  const app = createApp(ctx);
  const web = opts.web ?? (config.webDir ? folderSource(config.webDir) : emptySource);

  const handle = (
    req: Request,
    server: Server<unknown>,
    transport: "https" | "http",
  ): Response | Promise<Response> => {
    const ip = server.requestIP(req)?.address;
    const loopback = isLoopback(ip);
    const url = new URL(req.url);
    if (transport === "http" && !loopback) {
      // Plain HTTP on the LAN only helps people reach HTTPS and trust the certificate.
      if (url.pathname === "/stint-ca.crt") {
        return new Response(tls.caPem, {
          headers: {
            "content-type": "application/x-x509-ca-cert",
            "content-disposition": 'attachment; filename="stint-ca.crt"',
          },
        });
      }
      const target = `https://${url.hostname}:${ctx.runtime.httpsPort}${url.pathname}${url.search}`;
      return Response.redirect(target, 302);
    }
    if (url.pathname.startsWith("/api/")) return app.fetch(req, { ip, loopback });
    if (url.pathname === "/stint-ca.crt") {
      return new Response(tls.caPem, {
        headers: {
          "content-type": "application/x-x509-ca-cert",
          "content-disposition": 'attachment; filename="stint-ca.crt"',
        },
      });
    }
    return serveStatic(web, url.pathname);
  };

  const https = listenWithFallback(config.port, (port) =>
    Bun.serve({
      port,
      hostname: "0.0.0.0",
      tls: { cert: tls.cert, key: tls.key },
      fetch(req, server) {
        return handle(req, server, "https");
      },
    }),
  );
  const http = listenWithFallback(config.httpPort, (port) =>
    Bun.serve({
      port,
      hostname: "0.0.0.0",
      fetch(req, server) {
        return handle(req, server, "http");
      },
    }),
  );
  ctx.runtime.httpsPort = https.port ?? null;
  ctx.runtime.httpPort = http.port ?? null;
  const adminUrl = `http://localhost:${http.port}/`;

  const runtime: RuntimeFile = {
    pid: process.pid,
    version: opts.version,
    httpsPort: https.port!,
    httpPort: http.port!,
    startedAt: ctx.runtime.startedAt,
    adminUrl,
  };
  mkdirSync(join(config.dataDir, "run"), { recursive: true });
  writeFileSync(runtimeFilePath(config.dataDir), JSON.stringify(runtime, null, 2));
  log.info(`Stint Server ${opts.version} running`, {
    https: `https://${hostname}:${https.port}`,
    admin: adminUrl,
    addresses,
    dataDir: config.dataDir,
  });

  // ctx.db (not db): a restore swaps the database underneath us.
  const housekeeping = setInterval(() => pruneSessions(ctx.db, Date.now()), 3600_000);
  const stopBackups = startBackupScheduler(ctx);
  const stopUpdates = startUpdateChecks(ctx);
  const discovery = config.discovery
    ? startDiscovery(
        () => ({
          serverId: getMeta(ctx.db, "server_id") ?? "",
          organizationName: getOrgRow(ctx.db)?.name ?? "",
          version: opts.version,
          port: https.port!,
          caFingerprint: tls.caFingerprint,
          addresses: () => ctx.runtime.addresses,
        }),
        config.discoveryPort,
        log,
      )
    : null;

  return {
    ctx,
    https,
    http,
    adminUrl,
    async stop() {
      clearInterval(housekeeping);
      stopBackups();
      stopUpdates();
      platform.stop();
      discovery?.stop();
      await https.stop(true);
      await http.stop(true);
      ctx.db.close();
    },
  };
}
