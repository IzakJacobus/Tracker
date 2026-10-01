import { describe, expect, test } from "bun:test";
import {
  decodePairingCode,
  encodePairingCode,
  fingerprintPrefixHex,
  normalizePairingCode,
} from "../src/pairing.ts";

describe("pairing codes", () => {
  const info = { ip: "192.168.1.23", port: 47600, fingerprintPrefix: "a1b2c3d4e5f60718a9" };

  test("round-trip", () => {
    const code = encodePairingCode(info);
    expect(code).toMatch(/^([0-9A-Z]{4}-){5}[0-9A-Z]{4}$/);
    expect(code).toBe("R2M0-25XS-Y2GV-5GYM-WQV0-E659"); // shared with the desktop app's Rust tests
    expect(decodePairingCode(code)).toEqual(info);
  });

  test("carries 72 bits of the certificate fingerprint, not just 32", () => {
    // The old 16-character format is rejected.
    expect(decodePairingCode("R2M0-25XS-Y2GV-5GYM")).toBeNull();
    expect(decodePairingCode(encodePairingCode(info))?.fingerprintPrefix).toHaveLength(18);
  });

  test("forgiving input: lower case, spaces, look-alike letters", () => {
    const code = encodePairingCode(info);
    const messy = ` ${code.toLowerCase().replace(/-/g, " ").replace(/1/g, "l").replace(/0/g, "o")} `;
    expect(decodePairingCode(messy)).toEqual(info);
  });

  test("rejects wrong lengths and characters", () => {
    expect(decodePairingCode("ABCD")).toBeNull();
    expect(decodePairingCode("!!!!-!!!!-!!!!-!!!!-!!!!-!!!!")).toBeNull();
  });

  test("fingerprint prefix from base64url SHA-256", () => {
    // 0xa1b2c3d4… → base64url "obLD1A…"
    const fp = btoa(String.fromCharCode(0xa1, 0xb2, 0xc3, 0xd4, 0xe5, 0xf6, 0x07, 0x18, 0xa9, 0, 0, 0))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(fingerprintPrefixHex(fp)).toBe("a1b2c3d4e5f60718a9");
  });

  test("normalisation", () => {
    expect(normalizePairingCode("ab-cd io")).toBe("ABCD10");
  });

  test("rejects invalid addresses when encoding", () => {
    expect(() => encodePairingCode({ ...info, ip: "300.1.1.1" })).toThrow();
  });
});
