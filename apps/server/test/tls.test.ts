import "reflect-metadata";
import { describe, expect, test } from "bun:test";
import * as x509 from "@peculiar/x509";
import { migrate } from "../src/db/migrate.ts";
import { migrations } from "../src/db/migrations/index.ts";
import { openDatabase } from "../src/db/open.ts";
import { ensureTls } from "../src/net/tls.ts";

describe("TLS", () => {
  test("creates a CA once and re-issues the leaf when addresses change", async () => {
    const db = openDatabase(":memory:");
    migrate(db, migrations);
    const a = await ensureTls(
      db,
      { dns: ["localhost", "office-pc"], ips: ["127.0.0.1", "192.168.1.10"] },
      "Karoo",
    );
    const b = await ensureTls(
      db,
      { dns: ["localhost", "office-pc"], ips: ["127.0.0.1", "192.168.1.10"] },
      "Karoo",
    );
    expect(b.cert).toBe(a.cert);
    const c = await ensureTls(
      db,
      { dns: ["localhost", "office-pc"], ips: ["127.0.0.1", "192.168.1.23"] },
      "Karoo",
    );
    expect(c.cert).not.toBe(a.cert);
    expect(c.caFingerprint).toBe(a.caFingerprint);
    expect(c.caPem).toBe(a.caPem);
    const leaf = new x509.X509Certificate(
      `${c.cert.split("\n-----END CERTIFICATE-----")[0]}\n-----END CERTIFICATE-----`,
    );
    const san = leaf.getExtension(x509.SubjectAlternativeNameExtension)!;
    expect(san.names.toJSON().map((n) => n.value)).toContain("192.168.1.23");
    const ca = new x509.X509Certificate(c.caPem);
    expect(await leaf.verify({ publicKey: ca.publicKey })).toBe(true);
  });

  test("serves HTTPS that verifies against the CA", async () => {
    const db = openDatabase(":memory:");
    migrate(db, migrations);
    const t = await ensureTls(db, { dns: ["localhost"], ips: ["127.0.0.1"] });
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      tls: { cert: t.cert, key: t.key },
      fetch: () => new Response("hello"),
    });
    try {
      const res = await fetch(`https://localhost:${server.port}/`, { tls: { ca: t.caPem } } as RequestInit);
      expect(await res.text()).toBe("hello");
    } finally {
      server.stop(true);
    }
  });
});
