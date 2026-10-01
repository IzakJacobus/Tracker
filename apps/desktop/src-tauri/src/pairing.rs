//! Pairing codes (same format as packages/shared/src/pairing.ts):
//! 24 Crockford base32 characters = IPv4 (4 bytes) + port (2) + CA fingerprint prefix (9).
//! 72 bits of fingerprint: too many to forge by generating keys until one matches.

const ALPHABET: &[u8] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
pub const PREFIX_BYTES: usize = 9;
const CODE_BYTES: usize = 6 + PREFIX_BYTES;
const CODE_CHARS: usize = CODE_BYTES * 8 / 5;

#[derive(Debug, PartialEq, Eq)]
pub struct PairingCode {
    pub ip: String,
    pub port: u16,
    pub fingerprint_prefix: [u8; PREFIX_BYTES],
}

pub fn normalize(input: &str) -> String {
    input
        .to_uppercase()
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .map(|c| match c {
            'I' | 'L' => '1',
            'O' => '0',
            'U' => 'V',
            c => c,
        })
        .collect()
}

pub fn decode(input: &str) -> Option<PairingCode> {
    let s = normalize(input);
    if s.len() != CODE_CHARS {
        return None;
    }
    let mut bits: u32 = 0;
    let mut value: u64 = 0;
    let mut out = Vec::with_capacity(CODE_BYTES);
    for ch in s.bytes() {
        let i = ALPHABET.iter().position(|a| *a == ch)? as u64;
        value = (value << 5) | i;
        bits += 5;
        if bits >= 8 {
            out.push(((value >> (bits - 8)) & 0xff) as u8);
            bits -= 8;
        }
    }
    if out.len() != CODE_BYTES {
        return None;
    }
    let port = u16::from(out[4]) << 8 | u16::from(out[5]);
    if port == 0 {
        return None;
    }
    Some(PairingCode {
        ip: format!("{}.{}.{}.{}", out[0], out[1], out[2], out[3]),
        port,
        fingerprint_prefix: out[6..CODE_BYTES].try_into().ok()?,
    })
}

/// Does a base64url fingerprint start with these bytes?
pub fn fingerprint_matches_prefix(fp_b64url: &str, prefix: &[u8; PREFIX_BYTES]) -> bool {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    URL_SAFE_NO_PAD.decode(fp_b64url).map(|b| b.len() >= PREFIX_BYTES && b[..PREFIX_BYTES] == prefix[..]).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FP: [u8; PREFIX_BYTES] = [0xa1, 0xb2, 0xc3, 0xd4, 0xe5, 0xf6, 0x07, 0x18, 0xa9];

    #[test]
    fn decodes_the_shared_test_vector() {
        let code = crate::pairing::tests::encode("192.168.1.23", 47600, FP);
        let d = decode(&code).unwrap();
        assert_eq!(d.ip, "192.168.1.23");
        assert_eq!(d.port, 47600);
        assert_eq!(d.fingerprint_prefix, FP);
        assert_eq!(decode(&code.to_lowercase().replace('1', "l")), Some(d));
    }

    #[test]
    fn matches_the_typescript_encoder() {
        // bun: encodePairingCode({ ip: "192.168.1.23", port: 47600, fingerprintPrefix: "a1b2c3d4e5f60718a9" })
        let d = decode("R2M0-25XS-Y2GV-5GYM-WQV0-E659").unwrap();
        assert_eq!(d, PairingCode { ip: "192.168.1.23".into(), port: 47600, fingerprint_prefix: FP });
    }

    #[test]
    fn rejects_bad_codes() {
        assert!(decode("ABCD").is_none());
        assert!(decode("!!!!-!!!!-!!!!-!!!!-!!!!-!!!!").is_none());
        // The old, short (32-bit) format is no longer accepted.
        assert!(decode("R2M0-25XS-Y2GV-5GYM").is_none());
    }

    #[test]
    fn prefix_check_needs_all_nine_bytes() {
        use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
        let mut full = [0u8; 32];
        full[..PREFIX_BYTES].copy_from_slice(&FP);
        assert!(fingerprint_matches_prefix(&URL_SAFE_NO_PAD.encode(full), &FP));
        full[8] ^= 1; // only the last prefix byte differs
        assert!(!fingerprint_matches_prefix(&URL_SAFE_NO_PAD.encode(full), &FP));
    }

    pub fn encode(ip: &str, port: u16, fp: [u8; PREFIX_BYTES]) -> String {
        let mut bytes: Vec<u8> = ip.split('.').map(|p| p.parse().unwrap()).collect();
        bytes.push((port >> 8) as u8);
        bytes.push((port & 0xff) as u8);
        bytes.extend_from_slice(&fp);
        let mut out = String::new();
        let (mut bits, mut value) = (0u32, 0u64);
        for b in bytes {
            value = (value << 8) | u64::from(b);
            bits += 8;
            while bits >= 5 {
                out.push(ALPHABET[((value >> (bits - 5)) & 31) as usize] as char);
                bits -= 5;
            }
        }
        out
    }
}
