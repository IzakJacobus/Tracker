import { describe, expect, test } from "bun:test";
import { createUuidv7, isUuid, uuidv7, uuidv7Time } from "../src/uuid.ts";

describe("uuidv7", () => {
  test("produces valid version-7 UUIDs", () => {
    const id = uuidv7();
    expect(isUuid(id)).toBe(true);
    expect(id[14]).toBe("7");
    expect(["8", "9", "a", "b"]).toContain(id[19]!);
  });

  test("embeds the timestamp", () => {
    const t = Date.UTC(2026, 0, 15, 8, 30);
    expect(uuidv7Time(createUuidv7()(t))).toBe(t);
  });

  test("is strictly increasing even within one millisecond", () => {
    const ids = Array.from({ length: 2000 }, () => uuidv7(1_700_000_000_000));
    const sorted = [...ids].sort();
    expect(sorted).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("does not go backwards if the clock does", () => {
    const gen = createUuidv7();
    const a = gen(1_800_000_000_000);
    const b = gen(1_700_000_000_000);
    expect(b > a).toBe(true);
  });
});
