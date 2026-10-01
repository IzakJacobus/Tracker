import type { Project, TimeEntry } from "@stint/shared";
import { describe, expect, it } from "vitest";
import { daySegments } from "../src/pages/track/WeekHeader.tsx";

const project = (id: string, name: string, color: string, parentId: string | null = null) =>
  ({ id, name, color, parentId }) as Project;
const entry = (projectId: string, durationS: number | null, startedAt = 0) =>
  ({ projectId, durationS, startedAt, entryDate: "2026-09-29" }) as TimeEntry;

const byId = new Map(
  [
    project("bridge", "Paarl bridge", "#2463a6"),
    project("design", "Detailed design", "#2463a6", "bridge"),
    project("admin", "Administration", "#475569"),
    project("pipe", "Berg River pipeline", "#b86e12"),
    project("dam", "Tailings dam", "#6d5bd0"),
    project("roads", "Rural roads", "#be185d"),
  ].map((p) => [p.id, p]),
);

describe("day bar segments", () => {
  it("one piece per top-level project in its colour, largest first; sub-projects count with their parent", () => {
    const s = daySegments(
      [entry("admin", 1800), entry("design", 3600), entry("bridge", 600), entry("design", 1800)],
      byId,
      0,
    );
    expect(s).toEqual([
      { key: "bridge", label: "Paarl bridge", color: "#2463a6", seconds: 6000 },
      { key: "admin", label: "Administration", color: "#475569", seconds: 1800 },
    ]);
  });

  it("folds everything past the third project into a grey 'Other' piece", () => {
    const s = daySegments(
      [
        entry("design", 5000),
        entry("pipe", 4000),
        entry("dam", 3000),
        entry("admin", 2000),
        entry("roads", 1000),
      ],
      byId,
      0,
    );
    expect(s.map((x) => x.key)).toEqual(["bridge", "pipe", "dam", "other"]);
    expect(s[3]).toMatchObject({ label: "2 other projects", seconds: 3000 });
  });

  it("counts a running timer up to now", () => {
    const s = daySegments([entry("pipe", null, 1_000)], byId, 1_000 + 90 * 60_000);
    expect(s[0]?.seconds).toBe(5400);
  });
});
