import { describe, expect, test } from "bun:test";
import dgram from "node:dgram";
import { silentLogger } from "../src/lib/log.ts";
import { DISCOVERY_QUERY, startDiscovery } from "../src/net/discovery.ts";

describe("UDP discovery responder", () => {
  test("answers STINT? with the server's identity", async () => {
    const port = 47000 + Math.floor(Math.random() * 500);
    const d = startDiscovery(
      () => ({
        serverId: "sid",
        organizationName: "Karoo",
        version: "1.0.0",
        port: 47600,
        caFingerprint: "fp",
        addresses: () => ["192.168.1.5"],
      }),
      port,
      silentLogger,
    );
    try {
      await new Promise((r) => setTimeout(r, 100));
      const client = dgram.createSocket("udp4");
      const reply = await new Promise<Record<string, unknown>>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("no reply")), 2000);
        client.on("message", (msg) => {
          clearTimeout(t);
          resolve(JSON.parse(msg.toString()));
        });
        client.send(Buffer.from(DISCOVERY_QUERY), port, "127.0.0.1");
      });
      client.close();
      expect(reply).toMatchObject({
        product: "stint",
        id: "sid",
        name: "Karoo",
        port: 47600,
        fp: "fp",
        addresses: ["192.168.1.5"],
      });
    } finally {
      d.stop();
    }
  });
});
