import { describe, expect, test } from "bun:test";
import { amountFor, type RateContext, resolveBillable, resolveRate } from "../src/rates.ts";

const base: RateContext = {
  organizationDefault: 50_000,
  user: { id: "u1", rate: 80_000 },
  client: { id: "c1", rate: 90_000 },
  projectChain: [
    { id: "wp", rate: null },
    { id: "sub", rate: 110_000 },
    { id: "root", rate: 100_000 },
  ],
  memberRates: new Map(),
  task: { id: "t1", rate: 120_000 },
};

describe("rate resolution: task > project > client > user > organisation", () => {
  test("task wins", () => {
    expect(resolveRate(base)).toEqual({ rate: 120_000, source: "task", sourceId: "t1" });
  });
  test("then the nearest project with a rate", () => {
    expect(resolveRate({ ...base, task: { id: "t1", rate: null } })).toEqual({
      rate: 110_000,
      source: "project",
      sourceId: "sub",
    });
    expect(resolveRate({ ...base, task: null })).toMatchObject({ rate: 110_000, source: "project" });
  });
  test("walks all the way up the tree", () => {
    const chain = [
      { id: "wp", rate: null },
      { id: "sub", rate: null },
      { id: "root", rate: 100_000 },
    ];
    expect(resolveRate({ ...base, task: null, projectChain: chain })).toMatchObject({
      rate: 100_000,
      sourceId: "root",
    });
  });
  test("then client", () => {
    const chain = base.projectChain.map((p) => ({ ...p, rate: null }));
    expect(resolveRate({ ...base, task: null, projectChain: chain })).toMatchObject({
      rate: 90_000,
      source: "client",
    });
  });
  test("then the person", () => {
    const chain = base.projectChain.map((p) => ({ ...p, rate: null }));
    expect(
      resolveRate({ ...base, task: null, projectChain: chain, client: { id: "c1", rate: null } }),
    ).toMatchObject({
      rate: 80_000,
      source: "user",
    });
  });
  test("then the organisation default", () => {
    const chain = base.projectChain.map((p) => ({ ...p, rate: null }));
    expect(
      resolveRate({ ...base, task: null, projectChain: chain, client: null, user: { id: "u1", rate: null } }),
    ).toEqual({ rate: 50_000, source: "organization", sourceId: null });
  });
  test("zero is a real rate (pro bono), not 'unset'", () => {
    expect(resolveRate({ ...base, task: { id: "t1", rate: 0 } })).toMatchObject({ rate: 0, source: "task" });
  });
  test("a per-person project rate beats that project's rate but not a nearer sub-project rate", () => {
    const withMember = { ...base, task: null, memberRates: new Map([["root", 150_000]]) };
    expect(resolveRate(withMember)).toMatchObject({ rate: 110_000, sourceId: "sub" });
    const onSub = { ...base, task: null, memberRates: new Map([["sub", 150_000]]) };
    expect(resolveRate(onSub)).toMatchObject({ rate: 150_000, source: "member", sourceId: "sub" });
  });
  test("a membership without its own rate is ignored", () => {
    expect(resolveRate({ ...base, task: null, memberRates: new Map([["wp", null]]) })).toMatchObject({
      source: "project",
    });
  });
});

describe("billability", () => {
  test("inherits from the project unless the task says otherwise", () => {
    expect(resolveBillable(null, { billableDefault: true })).toBe(true);
    expect(resolveBillable({ billable: null }, { billableDefault: false })).toBe(false);
    expect(resolveBillable({ billable: false }, { billableDefault: true })).toBe(false);
    expect(resolveBillable({ billable: true }, { billableDefault: false })).toBe(true);
  });
});

describe("amounts", () => {
  test("rounds to the nearest cent", () => {
    expect(amountFor(3600, 95_000)).toBe(95_000);
    expect(amountFor(1800, 95_000)).toBe(47_500);
    expect(amountFor(1, 95_000)).toBe(26); // 26.39 cents
    expect(amountFor(0, 95_000)).toBe(0);
    expect(amountFor(3600, null)).toBe(0);
  });
});
