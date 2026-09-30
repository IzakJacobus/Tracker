import { formatDate, formatDuration, type OrgSettings } from "@stint/shared";

const moneyFmt = new Map<string, Intl.NumberFormat>();

export function formatMoney(minor: number | null | undefined, currency: string, locale = "en-ZA"): string {
  if (minor === null || minor === undefined) return "—";
  const key = `${locale}|${currency}`;
  let f = moneyFmt.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    } catch {
      f = new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" });
    }
    moneyFmt.set(key, f);
  }
  return f.format(minor / 100);
}

/** "950", "950.50", "R 1 200,00" → minor units. */
export function parseMoneyInput(input: string): number | null {
  const s = input.replace(/[^\d.,-]/g, "").replace(/\s/g, "");
  if (!s) return null;
  // treat the last separator as the decimal point if it has 1–2 digits after it
  const m = /^(-?[\d.,]*?)(?:[.,](\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const whole = (m[1] ?? "").replace(/[.,]/g, "");
  const frac = (m[2] ?? "").padEnd(2, "0");
  const n = Number(`${whole || "0"}.${frac}`);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export function moneyInputValue(minor: number | null | undefined): string {
  return minor === null || minor === undefined ? "" : (minor / 100).toFixed(2);
}

export function fmtDate(date: string, settings: Pick<OrgSettings, "dateFormat">): string {
  return formatDate(date, settings.dateFormat);
}

export function fmtHours(seconds: number): string {
  return formatDuration(seconds);
}

export function fmtDecimalHours(seconds: number): string {
  return (seconds / 3600).toFixed(2);
}
