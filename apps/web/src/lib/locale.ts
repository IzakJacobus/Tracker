export function timeZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
  const list = intl.supportedValuesOf?.("timeZone") ?? [];
  const base = list.length ? list : ["Africa/Johannesburg", "UTC", "Europe/London", "America/New_York"];
  return base.includes("Africa/Johannesburg") ? base : ["Africa/Johannesburg", ...base];
}

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
