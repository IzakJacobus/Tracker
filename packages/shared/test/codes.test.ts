import { describe, expect, test } from "bun:test";
import { codeKey, suggestNextCode } from "../src/codes.ts";

describe("project codes", () => {
  test("codes compare ignoring case and spaces", () => {
    expect(codeKey("  BRG-07 ")).toBe(codeKey("brg-07"));
  });

  test("the next code follows the client's own pattern", () => {
    expect(suggestNextCode(["2026-014", "2026-009"])).toBe("2026-015");
    expect(suggestNextCode(["BRG-9"])).toBe("BRG-10");
    expect(suggestNextCode(["A007", "A008"])).toBe("A009");
    expect(suggestNextCode(["P-099"])).toBe("P-100");
  });

  test("codes without a number are ignored; with none at all the fallback is used", () => {
    expect(suggestNextCode(["Alpha", null, ""])).toBe("P-001");
    expect(suggestNextCode([], "2026-001")).toBe("2026-001");
    expect(suggestNextCode(["Alpha", "Beta-3"])).toBe("Beta-4");
  });

  test("a suggestion is never a code that is already used", () => {
    expect(suggestNextCode(["P-001"], "P-001")).toBe("P-002");
    expect(suggestNextCode(["x-5", "X-6"])).toBe("X-7");
    expect(suggestNextCode(["P-002", "p-001"], "P-001")).toBe("P-003");
  });
});
