import { encodePairingCode, fingerprintPrefixHex } from "@stint/shared";
import { Hono } from "hono";
import QRCode from "qrcode";
import { requireAuth } from "../auth/middleware.ts";
import type { AppContext } from "../context.ts";
import type { HonoEnv } from "../http.ts";
import { primaryAddress } from "../net/addresses.ts";

export function pairingInfo(ctx: AppContext): { code: string | null; ip: string | null; url: string | null } {
  const ip = primaryAddress(ctx.runtime.addresses);
  const port = ctx.runtime.httpsPort;
  const fp = ctx.runtime.caFingerprint;
  if (!ip || !port || !fp) return { code: null, ip, url: null };
  const code = encodePairingCode({ ip, port, fingerprintPrefix: fingerprintPrefixHex(fp) });
  return { code, ip, url: `https://${ip}:${port}/#pair=${code}` };
}

export function pairingRoutes(ctx: AppContext) {
  const r = new Hono<HonoEnv>();
  r.get("/", requireAuth, async (c) => {
    const p = pairingInfo(ctx);
    const qrSvg = p.url
      ? await QRCode.toString(p.url, { type: "svg", margin: 0, errorCorrectionLevel: "M" })
      : null;
    return c.json({
      code: p.code,
      qrSvg,
      addresses: ctx.runtime.addresses,
      port: ctx.runtime.httpsPort,
      hostname: ctx.runtime.hostname,
      networkWarning: ctx.runtime.networkWarning ?? null,
    });
  });
  return r;
}
