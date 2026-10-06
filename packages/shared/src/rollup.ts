/**
 * Project tree helpers and bottom-up rollups. Projects nest to any depth via
 * parentId; a node's rolled-up total is its own total plus all descendants'.
 */
export interface TreeNode {
  id: string;
  parentId: string | null;
}

export interface Tree<T extends TreeNode> {
  byId: Map<string, T>;
  children: Map<string | null, T[]>;
  roots: T[];
}

export function buildTree<T extends TreeNode>(nodes: readonly T[], sort?: (a: T, b: T) => number): Tree<T> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const children = new Map<string | null, T[]>();
  for (const n of nodes) {
    // Orphans (parent missing or deleted) are treated as roots so nothing disappears.
    const parent = n.parentId && byId.has(n.parentId) ? n.parentId : null;
    const list = children.get(parent);
    if (list) list.push(n);
    else children.set(parent, [n]);
  }
  if (sort) for (const list of children.values()) list.sort(sort);
  return { byId, children, roots: children.get(null) ?? [] };
}

/** The node and all of its descendants (depth-first, cycle-safe). */
export function subtreeIds<T extends TreeNode>(tree: Tree<T>, id: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur) || !tree.byId.has(cur)) continue;
    seen.add(cur);
    out.push(cur);
    for (const c of tree.children.get(cur) ?? []) stack.push(c.id);
  }
  return out;
}

/** Ancestors of a node, nearest first (excluding the node). */
export function ancestorIds<T extends TreeNode>(tree: Tree<T>, id: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>([id]);
  let cur = tree.byId.get(id)?.parentId ?? null;
  while (cur && !seen.has(cur) && tree.byId.has(cur)) {
    seen.add(cur);
    out.push(cur);
    cur = tree.byId.get(cur)?.parentId ?? null;
  }
  return out;
}

/** Would making `newParentId` the parent of `id` create a cycle? */
export function wouldCreateCycle<T extends TreeNode>(
  tree: Tree<T>,
  id: string,
  newParentId: string | null,
): boolean {
  if (newParentId === null) return false;
  if (newParentId === id) return true;
  return subtreeIds(tree, id).includes(newParentId);
}

export function depthOf<T extends TreeNode>(tree: Tree<T>, id: string): number {
  return ancestorIds(tree, id).length;
}

/** Depth-first flattening for tree lists, with depth. */
export function flattenTree<T extends TreeNode>(tree: Tree<T>): { node: T; depth: number }[] {
  const out: { node: T; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (list: T[], depth: number) => {
    for (const n of list) {
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      out.push({ node: n, depth });
      walk(tree.children.get(n.id) ?? [], depth + 1);
    }
  };
  walk(tree.roots, 0);
  return out;
}

export interface Totals {
  seconds: number;
  entries: number;
}

export const zeroTotals = (): Totals => ({ seconds: 0, entries: 0 });

export function addTotals(a: Totals, b: Totals): Totals {
  return { seconds: a.seconds + b.seconds, entries: a.entries + b.entries };
}

/**
 * Rolls per-project totals up the tree. Returns a map with an entry for every
 * node: own totals plus all descendants. Runs in O(n).
 */
export function rollup<T extends TreeNode>(
  tree: Tree<T>,
  own: ReadonlyMap<string, Totals>,
): Map<string, Totals> {
  const out = new Map<string, Totals>();
  const visiting = new Set<string>();
  const visit = (id: string): Totals => {
    const done = out.get(id);
    if (done) return done;
    if (visiting.has(id)) return zeroTotals(); // cycle guard
    visiting.add(id);
    let t = own.get(id) ?? zeroTotals();
    for (const c of tree.children.get(id) ?? []) t = addTotals(t, visit(c.id));
    visiting.delete(id);
    out.set(id, t);
    return t;
  };
  for (const id of tree.byId.keys()) visit(id);
  return out;
}

export type BudgetLevel = "none" | "ok" | "warning" | "over";

export interface BudgetStatus {
  hoursRatio: number | null;
  level: BudgetLevel;
}

/** Budget progress in hours: warning at 80 %, over at 100 %. */
export function budgetStatus(
  budget: { budgetMinutes: number | null },
  totals: Pick<Totals, "seconds">,
): BudgetStatus {
  const hoursRatio = budget.budgetMinutes ? totals.seconds / (budget.budgetMinutes * 60) : null;
  const level: BudgetLevel =
    hoursRatio === null ? "none" : hoursRatio >= 1 ? "over" : hoursRatio >= 0.8 ? "warning" : "ok";
  return { hoursRatio, level };
}
