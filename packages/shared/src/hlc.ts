/**
 * Hybrid logical clock.
 *
 * Serialised as `<ms:15 digits>:<counter:5 digits>:<node>` so plain string
 * comparison orders stamps correctly. `node` is a short, stable per-device id
 * and breaks ties deterministically.
 */
export interface Hlc {
  ms: number;
  counter: number;
  node: string;
}

const MS_WIDTH = 15;
const COUNTER_WIDTH = 5;
const MAX_COUNTER = 10 ** COUNTER_WIDTH - 1;

export function formatHlc(h: Hlc): string {
  return `${String(h.ms).padStart(MS_WIDTH, "0")}:${String(h.counter).padStart(COUNTER_WIDTH, "0")}:${h.node}`;
}

export function parseHlc(s: string): Hlc {
  const [ms, counter, ...node] = s.split(":");
  if (!ms || !counter || node.length === 0) throw new Error(`Invalid HLC: ${s}`);
  return { ms: Number(ms), counter: Number(counter), node: node.join(":") };
}

export function compareHlc(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export class HlcClock {
  private last: Hlc;

  constructor(
    readonly node: string,
    private readonly wall: () => number = Date.now,
  ) {
    this.last = { ms: 0, counter: 0, node };
  }

  /** Stamp for a new local event. */
  now(): string {
    const wall = this.wall();
    if (wall > this.last.ms) {
      this.last = { ms: wall, counter: 0, node: this.node };
    } else {
      this.bump();
    }
    return formatHlc(this.last);
  }

  /** Merge a stamp received from elsewhere so future local stamps sort after it. */
  observe(remote: string): void {
    const r = parseHlc(remote);
    const wall = this.wall();
    const maxMs = Math.max(wall, this.last.ms, r.ms);
    if (maxMs === this.last.ms && maxMs === r.ms) {
      this.last = { ms: maxMs, counter: Math.max(this.last.counter, r.counter), node: this.node };
      this.bump();
    } else if (maxMs === this.last.ms) {
      this.bump();
    } else if (maxMs === r.ms) {
      this.last = { ms: maxMs, counter: r.counter, node: this.node };
      this.bump();
    } else {
      this.last = { ms: maxMs, counter: 0, node: this.node };
    }
  }

  private bump(): void {
    if (this.last.counter >= MAX_COUNTER) {
      this.last = { ms: this.last.ms + 1, counter: 0, node: this.node };
    } else {
      this.last = { ...this.last, counter: this.last.counter + 1 };
    }
  }
}

/**
 * Server-side guard: a client stamp more than `maxSkewMs` ahead of the server
 * clock is clamped, so a PC with a wrong date cannot win every conflict.
 */
export function clampHlc(stamp: string, serverNow: number, maxSkewMs = 5 * 60_000): string {
  const h = parseHlc(stamp);
  if (h.ms > serverNow + maxSkewMs) {
    return formatHlc({ ms: serverNow, counter: h.counter, node: h.node });
  }
  return stamp;
}
