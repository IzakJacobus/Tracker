/**
 * In-memory login throttle. Two buckets:
 *  - per (email, ip): 5 failures in 15 minutes → locked for 15 minutes
 *  - per ip: 30 failures in 15 minutes → locked for 15 minutes (spraying)
 */
interface Bucket {
  failures: number[];
  lockedUntil: number;
}

export interface LimiterOptions {
  maxPerAccount: number;
  maxPerIp: number;
  windowMs: number;
  lockMs: number;
}

export class LoginLimiter {
  private buckets = new Map<string, Bucket>();
  private readonly opts: LimiterOptions;

  constructor(
    private readonly now: () => number = Date.now,
    opts: Partial<LimiterOptions> = {},
  ) {
    this.opts = { maxPerAccount: 5, maxPerIp: 30, windowMs: 15 * 60_000, lockMs: 15 * 60_000, ...opts };
  }

  /** Returns ms until the caller may try again, or 0 if allowed. */
  retryAfter(email: string, ip: string): number {
    const t = this.now();
    return Math.max(this.lockRemaining(`a:${email}|${ip}`, t), this.lockRemaining(`i:${ip}`, t));
  }

  fail(email: string, ip: string): void {
    this.record(`a:${email}|${ip}`, this.opts.maxPerAccount);
    this.record(`i:${ip}`, this.opts.maxPerIp);
  }

  succeed(email: string, ip: string): void {
    this.buckets.delete(`a:${email}|${ip}`);
  }

  private lockRemaining(key: string, t: number): number {
    const b = this.buckets.get(key);
    return b && b.lockedUntil > t ? b.lockedUntil - t : 0;
  }

  private record(key: string, max: number): void {
    const t = this.now();
    const b = this.buckets.get(key) ?? { failures: [], lockedUntil: 0 };
    b.failures = b.failures.filter((f) => t - f < this.opts.windowMs);
    b.failures.push(t);
    if (b.failures.length >= max) {
      b.lockedUntil = t + this.opts.lockMs;
      b.failures = [];
    }
    this.buckets.set(key, b);
    if (this.buckets.size > 10_000) this.prune(t);
  }

  private prune(t: number): void {
    for (const [k, b] of this.buckets) {
      if (b.lockedUntil < t && b.failures.every((f) => t - f >= this.opts.windowMs)) this.buckets.delete(k);
    }
  }
}
