export const CURRENCIES: { code: string; name: string }[] = [
  { code: "ZAR", name: "South African rand" },
  { code: "BWP", name: "Botswana pula" },
  { code: "NAD", name: "Namibian dollar" },
  { code: "LSL", name: "Lesotho loti" },
  { code: "SZL", name: "Eswatini lilangeni" },
  { code: "MZN", name: "Mozambican metical" },
  { code: "ZMW", name: "Zambian kwacha" },
  { code: "KES", name: "Kenyan shilling" },
  { code: "NGN", name: "Nigerian naira" },
  { code: "USD", name: "US dollar" },
  { code: "EUR", name: "Euro" },
  { code: "GBP", name: "British pound" },
  { code: "AUD", name: "Australian dollar" },
  { code: "CAD", name: "Canadian dollar" },
  { code: "NZD", name: "New Zealand dollar" },
  { code: "AED", name: "UAE dirham" },
  { code: "INR", name: "Indian rupee" },
];

export function timeZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
  const list = intl.supportedValuesOf?.("timeZone") ?? [];
  const base = list.length ? list : ["Africa/Johannesburg", "UTC", "Europe/London", "America/New_York"];
  return base.includes("Africa/Johannesburg") ? base : ["Africa/Johannesburg", ...base];
}

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
