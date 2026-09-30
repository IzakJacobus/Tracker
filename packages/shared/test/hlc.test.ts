import { describe, expect, test } from "bun:test";
import { clampHlc, compareHlc, formatHlc, HlcClock, parseHlc } from "../src/hlc.ts";

describe("HLC", () => {
  test("format/parse round-trip and lexicographic order", () => {
    const a = formatHlc({ ms: 1000, counter: 2, node: "a" });
    const b = formatHlc({ ms: 999, counter: 99, node: "z" });
    expect(parseHlc(a)).toEqual({ ms: 1000, counter: 2, node: "a" });
    expect(compareHlc(a, b)).toBe(1);
  });

  test("monotonic when wall clock stalls", () => {
    const clock = new HlcClock("n1", () => 5000);
    const s1 = clock.now();
    const s2 = clock.now();
    expect(compareHlc(s2, s1)).toBe(1);
  });

  test("monotonic when wall clock goes backwards", () => {
    let wall = 10_000;
    const clock = new HlcClock("n1", () => wall);
    const s1 = clock.now();
    wall = 1_000;
    const s2 = clock.now();
    expect(compareHlc(s2, s1)).toBe(1);
  });

  test("a lagging client stamps after anything it has observed", () => {
    const slow = new HlcClock("slow", () => 1_000);
    const remote = formatHlc({ ms: 50_000, counter: 3, node: "server" });
    slow.observe(remote);
    expect(compareHlc(slow.now(), remote)).toBe(1);
  });

  test("ties broken by node id", () => {
    const a = formatHlc({ ms: 1, counter: 0, node: "a" });
    const b = formatHlc({ ms: 1, counter: 0, node: "b" });
    expect(compareHlc(a, b)).toBe(-1);
  });

  test("clamps stamps from the future", () => {
    const future = formatHlc({ ms: 10_000_000, counter: 0, node: "x" });
    const clamped = clampHlc(future, 1_000);
    expect(parseHlc(clamped).ms).toBe(1_000);
    const ok = formatHlc({ ms: 1_100, counter: 0, node: "x" });
    expect(clampHlc(ok, 1_000)).toBe(ok);
  });
});
