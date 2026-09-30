/**
 * Hourly rate resolution. Most specific wins:
 *
 *   task → (per level of the project tree, nearest first: this person's project rate → project rate)
 *        → client → person → organisation default
 *
 * "Per level" means a sub-project's own rate beats a per-person rate set on its
 * parent, and a per-person rate on a project beats that project's general rate.
 * Rates are minor currency units (cents) per hour.
 */
export type RateSource = "task" | "member" | "project" | "client" | "user" | "organization";

export interface RateContext {
  organizationDefault: number;
  user: { id: string; rate: number | null };
  client: { id: string; rate: number | null } | null;
  /** the entry's project first, then its ancestors up to the root */
  projectChain: { id: string; rate: number | null }[];
  /** this user's memberships: project id → per-person rate (null = none) */
  memberRates: ReadonlyMap<string, number | null>;
  task: { id: string; rate: number | null } | null;
}

export interface ResolvedRate {
  rate: number;
  source: RateSource;
  sourceId: string | null;
}

export function resolveRate(ctx: RateContext): ResolvedRate {
  if (ctx.task && ctx.task.rate !== null)
    return { rate: ctx.task.rate, source: "task", sourceId: ctx.task.id };
  for (const p of ctx.projectChain) {
    const m = ctx.memberRates.get(p.id);
    if (m !== undefined && m !== null) return { rate: m, source: "member", sourceId: p.id };
    if (p.rate !== null) return { rate: p.rate, source: "project", sourceId: p.id };
  }
  if (ctx.client && ctx.client.rate !== null)
    return { rate: ctx.client.rate, source: "client", sourceId: ctx.client.id };
  if (ctx.user.rate !== null) return { rate: ctx.user.rate, source: "user", sourceId: ctx.user.id };
  return { rate: ctx.organizationDefault, source: "organization", sourceId: null };
}

/** Default billability for a new entry: the task's setting if it has one, else the project's. */
export function resolveBillable(
  task: { billable: boolean | null } | null,
  project: { billableDefault: boolean },
): boolean {
  if (task && task.billable !== null) return task.billable;
  return project.billableDefault;
}

/** Money for a duration at an hourly rate, rounded to the nearest minor unit. */
export function amountFor(seconds: number, ratePerHour: number | null): number {
  if (ratePerHour === null || seconds <= 0) return 0;
  return Math.round((seconds * ratePerHour) / 3600);
}
