import "reflect-metadata";
import type { Database } from "bun:sqlite";
import * as x509 from "@peculiar/x509";
import { getMeta, setMeta } from "../lib/meta.ts";

x509.cryptoProvider.set(crypto);

const ALG = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" } as const;
const DAY = 86_400_000;

export interface TlsMaterial {
  cert: string; // leaf + CA chain, PEM
  key: string; // leaf private key, PEM (PKCS#8)
  caPem: string;
  /** base64url(SHA-256(CA SubjectPublicKeyInfo)) — what clients pin */
  caFingerprint: string;
  sans: string[];
  /** When the server certificate expires (it is renewed on restart within 30 days of this). */
  leafNotAfter: number;
}

function randomSerial(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[0] = b[0]! & 0x7f; // positive
  return Buffer.from(b).toString("hex");
}

async function importKey(pem: string): Promise<CryptoKey> {
  const der = x509.PemConverter.decodeFirst(pem);
  return crypto.subtle.importKey("pkcs8", der, ALG, true, ["sign"]);
}

async function exportKey(key: CryptoKey): Promise<string> {
  return x509.PemConverter.encode(await crypto.subtle.exportKey("pkcs8", key), "PRIVATE KEY");
}

export async function spkiFingerprint(cert: x509.X509Certificate): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", cert.publicKey.rawData);
  return Buffer.from(digest).toString("base64url");
}

async function ensureCa(
  db: Database,
  orgHint: string,
): Promise<{ cert: x509.X509Certificate; key: CryptoKey }> {
  const certPem = getMeta(db, "tls_ca_cert");
  const keyPem = getMeta(db, "tls_ca_key");
  if (certPem && keyPem) {
    return { cert: new x509.X509Certificate(certPem), key: await importKey(keyPem) };
  }
  const keys = (await crypto.subtle.generateKey(ALG, true, ["sign", "verify"])) as CryptoKeyPair;
  const now = Date.now();
  const cn = `Stint Local CA ${orgHint}`
    .replace(/[,=+<>#;"\\]/g, " ")
    .slice(0, 60)
    .trim();
  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: randomSerial(),
    name: `CN=${cn}, O=Stint`,
    notBefore: new Date(now - DAY),
    notAfter: new Date(now + 20 * 365 * DAY),
    keys,
    signingAlgorithm: ALG,
    extensions: [
      new x509.BasicConstraintsExtension(true, 0, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign, true),
      await x509.SubjectKeyIdentifierExtension.create(keys.publicKey),
    ],
  });
  setMeta(db, "tls_ca_cert", cert.toString("pem"));
  setMeta(db, "tls_ca_key", await exportKey(keys.privateKey));
  return { cert, key: keys.privateKey };
}

/**
 * Ensures a CA (created once, stored in the database so a restored backup keeps the same certificate)
 * and a leaf certificate covering all current host names and IP addresses. The leaf
 * is re-issued whenever the address set changes or it is within 30 days of expiry.
 */
export async function ensureTls(
  db: Database,
  sans: { dns: string[]; ips: string[] },
  orgHint = "",
): Promise<TlsMaterial> {
  const ca = await ensureCa(db, orgHint);
  const wanted = [
    ...new Set([...sans.dns.map((d) => `dns:${d.toLowerCase()}`), ...sans.ips.map((i) => `ip:${i}`)]),
  ].sort();
  const leafPem = getMeta(db, "tls_leaf_cert");
  const leafKeyPem = getMeta(db, "tls_leaf_key");
  const leafSans = getMeta(db, "tls_leaf_sans");
  let leaf = leafPem ? new x509.X509Certificate(leafPem) : null;
  const fresh = leaf && leaf.notAfter.getTime() - Date.now() > 30 * DAY;
  if (!leaf || !leafKeyPem || !fresh || leafSans !== wanted.join(",")) {
    const keys = (await crypto.subtle.generateKey(ALG, true, ["sign", "verify"])) as CryptoKeyPair;
    const now = Date.now();
    leaf = await x509.X509CertificateGenerator.create({
      serialNumber: randomSerial(),
      subject: "CN=Stint Server, O=Stint",
      issuer: ca.cert.subject,
      notBefore: new Date(now - DAY),
      // Stay under the 398-day limit browsers enforce for leaf certificates.
      notAfter: new Date(now + 397 * DAY),
      signingKey: ca.key,
      publicKey: keys.publicKey,
      signingAlgorithm: ALG,
      extensions: [
        new x509.BasicConstraintsExtension(false, undefined, true),
        new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true),
        new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.serverAuth]),
        new x509.SubjectAlternativeNameExtension(
          wanted.map((w) => {
            const [type, value] = [w.slice(0, w.indexOf(":")), w.slice(w.indexOf(":") + 1)];
            return { type: type as "dns" | "ip", value };
          }),
        ),
        await x509.AuthorityKeyIdentifierExtension.create(ca.cert),
      ],
    });
    setMeta(db, "tls_leaf_cert", leaf.toString("pem"));
    setMeta(db, "tls_leaf_key", await exportKey(keys.privateKey));
    setMeta(db, "tls_leaf_sans", wanted.join(","));
  }
  const caPem = ca.cert.toString("pem");
  return {
    cert: `${leaf.toString("pem")}\n${caPem}`,
    key: getMeta(db, "tls_leaf_key")!,
    caPem,
    caFingerprint: await spkiFingerprint(ca.cert),
    sans: wanted,
    leafNotAfter: leaf.notAfter.getTime(),
  };
}
