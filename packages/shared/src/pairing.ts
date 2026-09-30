/**
 * Pairing codes: the fallback when automatic discovery can't find the server.
 *
 * 10 bytes = IPv4 address (4) + HTTPS port (2) + first 4 bytes of the CA
 * fingerprint (SHA-256 of the CA public key). Encoded as 16 Crockford base32
 * characters shown as XXXX-XXXX-XXXX-XXXX. The fingerprint prefix doubles as an
 * integrity check: a mistyped code either fails to connect or fails the
 * certificate check, so it can never silently pair with the wrong machine.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export interface PairingInfo {
  ip: string;
  port: number;
  /** first 4 bytes of the CA SPKI SHA-256, hex */
  fingerprintPrefix: string;
}

function toBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function fromBase32(s: string): Uint8Array | null {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of s) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) return null;
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** Normalises what people type: case, dashes, spaces, and look-alike letters. */
export function normalizePairingCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0")
    .replace(/U/g, "V");
}

export function fingerprintPrefixHex(fingerprintBase64Url: string): string {
  const b64 = fingerprintBase64Url.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Array.from(bin.slice(0, 4), (c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
}

export function encodePairingCode(info: PairingInfo): string {
  const parts = info.ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    throw new Error(`Not an IPv4 address: ${info.ip}`);
  }
  if (!/^[0-9a-f]{8}$/i.test(info.fingerprintPrefix))
    throw new Error("Fingerprint prefix must be 8 hex chars");
  const bytes = new Uint8Array(10);
  bytes.set(parts, 0);
  bytes[4] = (info.port >> 8) & 0xff;
  bytes[5] = info.port & 0xff;
  for (let i = 0; i < 4; i++)
    bytes[6 + i] = Number.parseInt(info.fingerprintPrefix.slice(i * 2, i * 2 + 2), 16);
  const s = toBase32(bytes);
  return s.match(/.{1,4}/g)!.join("-");
}

export function decodePairingCode(input: string): PairingInfo | null {
  const s = normalizePairingCode(input);
  if (s.length !== 16) return null;
  const bytes = fromBase32(s);
  if (bytes?.length !== 10) return null;
  const port = (bytes[4]! << 8) | bytes[5]!;
  if (port === 0) return null;
  return {
    ip: Array.from(bytes.slice(0, 4)).join("."),
    port,
    fingerprintPrefix: Array.from(bytes.slice(6, 10), (b) => b.toString(16).padStart(2, "0")).join(""),
  };
}
