import { describe, expect, test } from "bun:test";
import {
  addDays,
  dayOfWeek,
  daysBetween,
  endOfMonth,
  formatDate,
  formatDuration,
  isValidIsoDate,
  localDate,
  parseDurationInput,
  parseTimeInput,
  periodFor,
  startOfWeek,
  tzOffsetMs,
  weekDates,
  zonedToInstant,
} from "../src/dates.ts";

const JHB = "Africa/Johannesburg";

describe("timezones", () => {
  test("Johannesburg is UTC+2 with no DST", () => {
    expect(tzOffsetMs(Date.UTC(2026, 0, 1), JHB)).toBe(2 * 3600_000);
    expect(tzOffsetMs(Date.UTC(2026, 6, 1), JHB)).toBe(2 * 3600_000);
  });
  test("local date crosses midnight correctly", () => {
    // 23:30 UTC on 31 Jan is 01:30 on 1 Feb in Johannesburg
    expect(localDate(Date.UTC(2026, 0, 31, 23, 30), JHB)).toBe("2026-02-01");
  });
  test("zonedToInstant round-trips, including DST zones", () => {
    const t = zonedToInstant("2026-03-10", "08:30", JHB);
    expect(t).toBe(Date.UTC(2026, 2, 10, 6, 30));
    const ny = zonedToInstant("2026-07-01", "09:00", "America/New_York");
    expect(ny).toBe(Date.UTC(2026, 6, 1, 13, 0));
  });
});

describe("calendar arithmetic", () => {
  test("addDays across month and year boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
  });
  test("weeks start on the configured day", () => {
    expect(dayOfWeek("2026-09-30")).toBe(3); // Wednesday
    expect(startOfWeek("2026-09-30", 1)).toBe("2026-09-28");
    expect(startOfWeek("2026-09-28", 1)).toBe("2026-09-28");
    expect(startOfWeek("2026-09-27", 1)).toBe("2026-09-21");
    expect(startOfWeek("2026-09-30", 0)).toBe("2026-09-27");
    expect(weekDates("2026-09-30", 1)).toHaveLength(7);
  });
  test("month ends", () => {
    expect(endOfMonth("2026-02-10")).toBe("2026-02-28");
    expect(endOfMonth("2028-02-10")).toBe("2028-02-29");
  });
  test("approval periods", () => {
    expect(periodFor("2026-09-30", "month")).toEqual({ start: "2026-09-01", end: "2026-09-30" });
    // Weeks end on the approval day: Friday by default, so Wed 30 Sep belongs to the week ending Fri 2 Oct.
    expect(periodFor("2026-09-30", "week")).toEqual({ start: "2026-09-26", end: "2026-10-02" });
    expect(periodFor("2026-10-02", "week", 5)).toEqual({ start: "2026-09-26", end: "2026-10-02" });
    expect(periodFor("2026-10-03", "week", 5)).toEqual({ start: "2026-10-03", end: "2026-10-09" });
    // Monday–Sunday weeks (the old default) end on Sunday.
    expect(periodFor("2026-09-30", "week", 0)).toEqual({ start: "2026-09-28", end: "2026-10-04" });
    // Fortnights: every day belongs to exactly one, and neighbours join up.
    const f = periodFor("2026-09-30", "biweek", 5);
    expect(daysBetween(f.start, f.end)).toBe(13);
    expect(dayOfWeek(f.end)).toBe(5);
    expect(periodFor(f.start, "biweek", 5)).toEqual(f);
    expect(periodFor(f.end, "biweek", 5)).toEqual(f);
    expect(periodFor(addDays(f.end, 1), "biweek", 5)).toEqual({
      start: addDays(f.end, 1),
      end: addDays(f.end, 14),
    });
  });
  test("only real calendar dates are valid", () => {
    for (const ok of ["2026-09-30", "2028-02-29", "2000-01-01", "2099-12-31"]) {
      expect(isValidIsoDate(ok)).toBe(true);
    }
    for (const bad of [
      "2026-02-29",
      "2026-02-31",
      "2026-00-10",
      "2026-13-01",
      "2026-09-00",
      "0000-01-01",
      "2026-9-1",
      "x",
    ]) {
      expect(isValidIsoDate(bad)).toBe(false);
    }
  });
});

describe("formatting and parsing", () => {
  test("date formats", () => {
    expect(formatDate("2026-03-05", "YYYY-MM-DD")).toBe("2026-03-05");
    expect(formatDate("2026-03-05", "DD/MM/YYYY")).toBe("05/03/2026");
    expect(formatDate("2026-03-05", "D MMM YYYY")).toBe("5 Mar 2026");
  });
  test("durations", () => {
    expect(formatDuration(5400)).toBe("1:30");
    expect(formatDuration(59)).toBe("0:00");
    expect(formatDuration(3661, true)).toBe("1:01:01");
  });
  test.each([
    ["1:30", 5400],
    ["1h30", 5400],
    ["1h 30m", 5400],
    ["1.5", 5400],
    ["1,5", 5400],
    ["90m", 5400],
    ["2", 7200],
    ["45", 2700],
    ["2h", 7200],
  ])("parses duration %s", (input, expected) => {
    expect(parseDurationInput(input)).toBe(expected);
  });
  test("rejects nonsense durations", () => {
    expect(parseDurationInput("abc")).toBeNull();
    expect(parseDurationInput("")).toBeNull();
  });
  test("rejects minutes or seconds past 59 instead of rolling them over", () => {
    expect(parseDurationInput("1:75")).toBeNull();
    expect(parseDurationInput("1:30:60")).toBeNull();
    expect(parseDurationInput("1h 75m")).toBeNull();
    expect(parseDurationInput("1:59")).toBe(7140);
  });
  test.each([
    ["9", "09:00"],
    ["930", "09:30"],
    ["09:30", "09:30"],
    ["5pm", "17:00"],
    ["12am", "00:00"],
  ])("parses time %s", (input, expected) => {
    expect(parseTimeInput(input)).toBe(expected);
  });
  test("rejects invalid times", () => {
    expect(parseTimeInput("25:00")).toBeNull();
  });
});
