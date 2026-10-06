import { SetupInput } from "@stint/shared";
import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { createSession, SESSION_COOKIE, SESSION_TTL_MS } from "../auth/sessions.ts";
import type { AppContext } from "../context.ts";
import { body, clientIp, type HonoEnv } from "../http.ts";
import { ApiError, conflict } from "../lib/errors.ts";
import { getMeta } from "../lib/meta.ts";
import { runSetup } from "../services/bootstrap.ts";
import { getOrgRow, getOrgSettings, isSetupComplete } from "../services/org.ts";

function reachableAt(ctx: AppContext): string[] {
  const port = ctx.runtime.httpsPort;
  if (!port) return [];
  const ts = ctx.runtime.platform?.tailscale;
  const remote = getOrgSettings(ctx.db).remoteAccess.enabled && ts?.running;
  const hosts = [...ctx.runtime.addresses, ...(remote && ts.dnsName ? [ts.dnsName] : [])];
  return [...new Set(hosts)].map((h) => `${h}:${port}`);
}

export function systemRoutes(ctx: AppContext) {
  const r = new Hono<HonoEnv>();

  /** Public: identifies this server (name, version); also used as a readiness check. */
  r.get("/info", (c) => {
    const org = getOrgRow(ctx.db);
    return c.json({
      product: "stint",
      version: ctx.version,
      serverId: getMeta(ctx.db, "server_id"),
      organizationName: org?.name ?? null,
      setupComplete: org !== null,
      caFingerprint: ctx.runtime.caFingerprint,
      time: ctx.now(),
      /** host:port addresses this server answers on. */
      reachableAt: reachableAt(ctx),
    });
  });

  r.get("/setup/status", (c) =>
    c.json({ setupComplete: isSetupComplete(ctx.db), fromServerPc: c.env?.loopback === true }),
  );

  /**
   * First-run setup. Only allowed from the server PC itself (loopback), so nobody
   * else on the network can claim a freshly installed server.
   */
  r.post("/setup", async (c) => {
    if (isSetupComplete(ctx.db)) throw conflict("Stint is already set up.");
    if (c.env?.loopback !== true) {
      throw new ApiError(
        403,
        "setup_local_only",
        "Finish setup on the computer where Stint Server is installed.",
      );
    }
    const input = await body(c, SetupInput);
    const { adminId } = await runSetup(ctx.db, input, ctx.now(), clientIp(c));
    const token = createSession(ctx.db, adminId, "browser", ctx.now(), {
      userAgent: c.req.header("user-agent"),
      ip: clientIp(c),
    });
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
      path: "/",
      maxAge: SESSION_TTL_MS / 1000,
    });
    ctx.log.info("Setup complete", { organization: input.organizationName });
    return c.json({ ok: true, userId: adminId }, 201);
  });

  return r;
}
