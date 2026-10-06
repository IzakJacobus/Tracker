import { formatDate, formatDuration, type OrgSettings } from "@stint/shared";

export function fmtDate(date: string, settings: Pick<OrgSettings, "dateFormat">): string {
  return formatDate(date, settings.dateFormat);
}

export function fmtHours(seconds: number): string {
  return formatDuration(seconds);
}

export function fmtDecimalHours(seconds: number): string {
  return (seconds / 3600).toFixed(2);
}
