import type { Rounding } from "./schemas.ts";

/**
 * Applies the organisation's rounding rule to one entry's duration (seconds).
 * Stored durations are never changed; rounding is applied per entry in reports.
 */
export function roundSeconds(seconds: number, rule: Rounding): number {
  if (rule.mode === "none" || seconds <= 0) return Math.max(0, seconds);
  const step = rule.minutes * 60;
  const q = seconds / step;
  switch (rule.mode) {
    case "up":
      return Math.ceil(q - 1e-9) * step;
    case "down":
      return Math.floor(q + 1e-9) * step;
    case "nearest":
      return Math.round(q) * step;
  }
}

export function describeRounding(rule: Rounding): string {
  if (rule.mode === "none") return "Exact time";
  const verb = rule.mode === "up" ? "Rounded up" : rule.mode === "down" ? "Rounded down" : "Rounded";
  return `${verb} to ${rule.minutes} min`;
}
