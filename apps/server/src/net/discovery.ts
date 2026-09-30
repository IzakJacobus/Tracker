import dgram from "node:dgram";
import { Bonjour, type Service } from "bonjour-service";
import type { Logger } from "../lib/log.ts";

export interface DiscoveryInfo {
  serverId: string;
  organizationName: string;
  version: string;
  port: number;
  caFingerprint: string;
  addresses: () => string[];
}

export const DISCOVERY_QUERY = "STINT?";

/** The reply both discovery methods give (mDNS TXT carries the same fields). */
export function discoveryReply(info: DiscoveryInfo) {
  return {
    product: "stint",
    id: info.serverId,
    name: info.organizationName,
    version: info.version,
    port: info.port,
    fp: info.caFingerprint,
    addresses: info.addresses(),
  };
}

/**
 * Makes the server findable with zero configuration:
 *  - mDNS / DNS-SD: `_stint._tcp.local`, TXT = id, org, version, fingerprint
 *  - UDP broadcast fallback: clients send "STINT?" to port 47609, we answer with JSON
 */
export function startDiscovery(
  info: () => DiscoveryInfo,
  udpPort: number,
  log: Logger,
): { stop(): void; refresh(): void } {
  let bonjour: Bonjour | null = null;
  let service: Service | null = null;

  const publish = () => {
    try {
      const i = info();
      service?.stop?.();
      bonjour ??= new Bonjour(undefined, (err: Error) => log.warn("mDNS error", { error: err.message }));
      service = bonjour.publish({
        name: `Stint ${i.organizationName || "Server"}`.slice(0, 60),
        type: "stint",
        protocol: "tcp",
        port: i.port,
        txt: { id: i.serverId, org: i.organizationName, v: i.version, fp: i.caFingerprint },
      });
      service.on?.("error", (e: Error) => log.warn("mDNS publish failed", { error: e.message }));
    } catch (e) {
      log.warn("mDNS unavailable — clients can still use the broadcast fallback or a pairing code", {
        error: (e as Error).message,
      });
    }
  };
  publish();

  const udp = dgram.createSocket({ type: "udp4", reuseAddr: true });
  udp.on("error", (e) => log.warn("Discovery responder error", { error: e.message }));
  udp.on("message", (msg, rinfo) => {
    if (msg.toString("utf8").trim() !== DISCOVERY_QUERY) return;
    const reply = Buffer.from(JSON.stringify(discoveryReply(info())));
    udp.send(reply, rinfo.port, rinfo.address);
  });
  udp.bind(udpPort, "0.0.0.0", () => {
    try {
      udp.setBroadcast(true);
    } catch {
      // not fatal
    }
    log.info("Discovery responder listening", { udpPort });
  });

  return {
    refresh: publish,
    stop() {
      try {
        service?.stop?.();
        bonjour?.destroy();
      } catch {
        // ignore
      }
      udp.close();
    },
  };
}
