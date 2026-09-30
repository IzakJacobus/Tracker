/**
 * UUIDv7 (RFC 9562): 48-bit Unix ms timestamp, version, 74 random bits.
 * Monotonic within a process: if called twice in the same millisecond the
 * random tail is incremented so IDs still sort in creation order.
 */
function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

function incrementTail(tail: Uint8Array): boolean {
  for (let i = tail.length - 1; i >= 0; i--) {
    const v = tail[i]!;
    if (v < 0xff) {
      tail[i] = v + 1;
      return true;
    }
    tail[i] = 0;
  }
  return false;
}

/** Creates an independent monotonic UUIDv7 generator. */
export function createUuidv7(): (now?: number) => string {
  let lastMs = -1;
  let lastTail: Uint8Array | null = null;
  return (now: number = Date.now()) => {
    let ms = now;
    let tail: Uint8Array;
    if (ms <= lastMs && lastTail) {
      ms = lastMs;
      tail = lastTail;
      if (!incrementTail(tail)) {
        ms += 1;
        tail = randomBytes(10);
      }
    } else {
      tail = randomBytes(10);
    }
    lastMs = ms;
    lastTail = tail;

    const bytes = new Uint8Array(16);
    // 48-bit big-endian timestamp
    let t = ms;
    for (let i = 5; i >= 0; i--) {
      bytes[i] = t % 256;
      t = Math.floor(t / 256);
    }
    bytes.set(tail, 6);
    bytes[6] = 0x70 | (bytes[6]! & 0x0f); // version 7
    bytes[8] = 0x80 | (bytes[8]! & 0x3f); // RFC 4122 variant
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
}

/** Process-wide UUIDv7 generator. */
export const uuidv7: (now?: number) => string = createUuidv7();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Extracts the embedded timestamp (ms) from a UUIDv7. */
export function uuidv7Time(id: string): number {
  return Number.parseInt(id.replace(/-/g, "").slice(0, 12), 16);
}
