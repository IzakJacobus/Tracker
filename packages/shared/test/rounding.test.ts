import { describe, expect, test } from "bun:test";
import { describeRounding, roundSeconds } from "../src/rounding.ts";

describe("rounding", () => {
  test("none keeps exact time", () => {
    expect(roundSeconds(1234, { mode: "none", minutes: 15 })).toBe(1234);
  });
  test("up to 15 minutes", () => {
    const r = { mode: "up", minutes: 15 } as const;
    expect(roundSeconds(1, r)).toBe(900);
    expect(roundSeconds(900, r)).toBe(900);
    expect(roundSeconds(901, r)).toBe(1800);
  });
  test("down to 15 minutes", () => {
    const r = { mode: "down", minutes: 15 } as const;
    expect(roundSeconds(899, r)).toBe(0);
    expect(roundSeconds(1799, r)).toBe(900);
  });
  test("nearest 6 minutes (0.1 h billing)", () => {
    const r = { mode: "nearest", minutes: 6 } as const;
    expect(roundSeconds(179, r)).toBe(0);
    expect(roundSeconds(180, r)).toBe(360);
    expect(roundSeconds(539, r)).toBe(360);
    expect(roundSeconds(540, r)).toBe(720);
  });
  test("zero and negative stay zero", () => {
    expect(roundSeconds(0, { mode: "up", minutes: 15 })).toBe(0);
    expect(roundSeconds(-5, { mode: "up", minutes: 15 })).toBe(0);
  });
  test("describes the rule", () => {
    expect(describeRounding({ mode: "up", minutes: 15 })).toBe("Rounded up to 15 min");
    expect(describeRounding({ mode: "none", minutes: 15 })).toBe("Exact time");
  });
});
