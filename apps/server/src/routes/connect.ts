import { Hono } from "hono";
import QRCode from "qrcode";
import { requireAuth } from "../auth/middleware.ts";
import type { AppContext } from "../context.ts";
import type { HonoEnv } from "../http.ts";
import { primaryAddress } from "../net/addresses.ts";

export interface ConnectInfo {
  /** The address to share: the PC's name on the network, which survives IP changes. */
  url: string | null;
  /** Every address Stint answers on, for networks where the name doesn't resolve. */
  urls: string[];
}

/** The addresses people open in a browser on other computers, phones and tablets. */
export function connectInfo(ctx: AppContext): ConnectInfo {
  const port = ctx.runtime.httpsPort;
  if (!port) return { url: null, urls: [] };
  const byName = ctx.runtime.hostname ? `https://${ctx.runtime.hostname}.local:${port}` : null;
  const primary = primaryAddress(ctx.runtime.addresses);
  const byIp = [primary, ...ctx.runtime.addresses.filter((a) => a !== primary)]
    .filter((a): a is string => Boolean(a))
    .map((a) => `https://${a}:${port}`);
  const urls = byName ? [byName, ...byIp] : byIp;
  return { url: urls[0] ?? null, urls };
}

export function connectRoutes(ctx: AppContext) {
  const r = new Hono<HonoEnv>();
  r.get("/", requireAuth, async (c) => {
    const info = connectInfo(ctx);
    // The QR code uses an IP address: phones often can't resolve .local names.
    const qrTarget = info.urls.find((u) => !u.includes(".local:")) ?? info.url;
    const qrSvg = qrTarget
      ? await QRCode.toString(qrTarget, { type: "svg", margin: 0, errorCorrectionLevel: "M" })
      : null;
    return c.json({ ...info, qrUrl: qrTarget, qrSvg, networkWarning: ctx.runtime.networkWarning ?? null });
  });
  return r;
}
