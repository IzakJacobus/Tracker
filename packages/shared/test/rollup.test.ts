import { describe, expect, test } from "bun:test";
import {
  ancestorIds,
  budgetStatus,
  buildTree,
  flattenTree,
  rollup,
  subtreeIds,
  type Totals,
  wouldCreateCycle,
} from "../src/rollup.ts";

const nodes = [
  { id: "acme", parentId: null },
  { id: "bridge", parentId: "acme" },
  { id: "design", parentId: "bridge" },
  { id: "survey", parentId: "bridge" },
  { id: "wp1", parentId: "design" },
  { id: "roads", parentId: "acme" },
  { id: "other", parentId: null },
  { id: "orphan", parentId: "deleted-parent" },
];
const t = (seconds: number, billable = seconds, amount = 0, entries = 1): Totals => ({
  seconds,
  billableSeconds: billable,
  amount,
  entries,
});

describe("tree", () => {
  const tree = buildTree(nodes);
  test("subtree includes all descendants at any depth", () => {
    expect(subtreeIds(tree, "bridge").sort()).toEqual(["bridge", "design", "survey", "wp1"]);
    expect(subtreeIds(tree, "wp1")).toEqual(["wp1"]);
  });
  test("ancestors nearest first", () => {
    expect(ancestorIds(tree, "wp1")).toEqual(["design", "bridge", "acme"]);
  });
  test("orphans become roots instead of disappearing", () => {
    expect(tree.roots.map((r) => r.id)).toContain("orphan");
  });
  test("cycle detection for re-parenting", () => {
    expect(wouldCreateCycle(tree, "bridge", "wp1")).toBe(true);
    expect(wouldCreateCycle(tree, "bridge", "bridge")).toBe(true);
    expect(wouldCreateCycle(tree, "wp1", "roads")).toBe(false);
    expect(wouldCreateCycle(tree, "bridge", null)).toBe(false);
  });
  test("flatten gives depth-first order with depth", () => {
    const flat = flattenTree(tree).map((f) => `${f.depth}:${f.node.id}`);
    expect(flat.slice(0, 5)).toEqual(["0:acme", "1:bridge", "2:design", "3:wp1", "2:survey"]);
  });
  test("survives cycles in bad data", () => {
    const bad = buildTree([
      { id: "a", parentId: "b" },
      { id: "b", parentId: "a" },
    ]);
    expect(subtreeIds(bad, "a").length).toBeLessThanOrEqual(2);
    expect(() => rollup(bad, new Map([["a", t(1)]]))).not.toThrow();
  });
});

describe("rollup", () => {
  const tree = buildTree(nodes);
  const own = new Map<string, Totals>([
    ["acme", t(600)],
    ["bridge", t(1200, 0)],
    ["design", t(3600, 3600, 95_000)],
    ["wp1", t(1800, 1800, 47_500)],
    ["survey", t(900, 900, 20_000)],
    ["other", t(60)],
  ]);
  const rolled = rollup(tree, own);

  test("leaf totals are their own", () => {
    expect(rolled.get("wp1")).toEqual(t(1800, 1800, 47_500));
  });
  test("parents include every descendant", () => {
    expect(rolled.get("design")).toEqual({
      seconds: 5400,
      billableSeconds: 5400,
      amount: 142_500,
      entries: 2,
    });
    expect(rolled.get("bridge")).toEqual({
      seconds: 7500,
      billableSeconds: 6300,
      amount: 162_500,
      entries: 4,
    });
    expect(rolled.get("acme")?.seconds).toBe(8100);
  });
  test("root totals sum to the grand total with no double counting", () => {
    const grand = [...own.values()].reduce((s, x) => s + x.seconds, 0);
    const roots = tree.roots.reduce((s, r) => s + (rolled.get(r.id)?.seconds ?? 0), 0);
    expect(roots).toBe(grand);
  });
  test("nodes without entries get zero", () => {
    expect(rolled.get("roads")).toEqual({ seconds: 0, billableSeconds: 0, amount: 0, entries: 0 });
  });
  test("deep trees", () => {
    const deep = Array.from({ length: 500 }, (_, i) => ({
      id: `n${i}`,
      parentId: i === 0 ? null : `n${i - 1}`,
    }));
    const dt = buildTree(deep);
    const r = rollup(dt, new Map([["n499", t(10)]]));
    expect(r.get("n0")?.seconds).toBe(10);
  });
});

describe("budgets", () => {
  test("no budget", () => {
    expect(budgetStatus({ budgetMinutes: null, budgetAmount: null }, { seconds: 100, amount: 0 }).level).toBe(
      "none",
    );
  });
  test("warning at 80 %, over at 100 %", () => {
    const b = { budgetMinutes: 600, budgetAmount: null };
    expect(budgetStatus(b, { seconds: 0.79 * 36000, amount: 0 }).level).toBe("ok");
    expect(budgetStatus(b, { seconds: 0.8 * 36000, amount: 0 }).level).toBe("warning");
    expect(budgetStatus(b, { seconds: 36000, amount: 0 }).level).toBe("over");
  });
  test("the worse of hours and money decides", () => {
    const s = budgetStatus({ budgetMinutes: 600, budgetAmount: 100_000 }, { seconds: 3600, amount: 100_000 });
    expect(s.hoursRatio).toBeCloseTo(0.1);
    expect(s.amountRatio).toBe(1);
    expect(s.level).toBe("over");
  });
});
