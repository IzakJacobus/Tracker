/**
 * Project codes are free text, so every client can number its work its own way
 * ("2026-014", "BRG-07", "A12"…). These helpers keep that flexible but tidy.
 */

/** Codes are compared ignoring case and surrounding spaces. */
export const codeKey = (code: string): string => code.trim().toLowerCase();

/**
 * Suggests the next code in the pattern a client already uses: the highest code that ends in a
 * number is counted up, keeping its prefix and zero padding ("2026-014" → "2026-015",
 * "BRG-9" → "BRG-10"). With no numbered codes yet, `fallback` is used (and counted up if taken).
 */
export function suggestNextCode(
  existing: readonly (string | null | undefined)[],
  fallback = "P-001",
): string {
  const used = new Set(existing.filter((c): c is string => Boolean(c?.trim())).map(codeKey));
  const split = (code: string) => {
    const m = /^(.*?)(\d+)$/.exec(code.trim());
    return m ? { prefix: m[1]!, digits: m[2]!, n: Number(m[2]) } : null;
  };
  let best: { prefix: string; digits: string; n: number } | null = null;
  for (const c of existing) {
    const p = c ? split(c) : null;
    if (p && (!best || p.n > best.n)) best = p;
  }
  const base = best ?? split(fallback);
  if (!base) return used.has(codeKey(fallback)) ? `${fallback}-2` : fallback;
  let n = best ? base.n + 1 : base.n;
  for (let i = 0; i < 10_000; i++, n++) {
    const code = `${base.prefix}${String(n).padStart(base.digits.length, "0")}`;
    if (!used.has(codeKey(code))) return code;
  }
  return `${base.prefix}${n}`;
}
