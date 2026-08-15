import { describe, expect, it } from "vitest";
import {
  blockersToCompletion,
  computeProgress,
  gateScore,
  leafProgress,
  overallProgress,
  toPercent,
  type WorkItemInput,
} from "./progress.js";

const leaf = (
  id: string,
  status: WorkItemInput["status"],
  overrides: Partial<WorkItemInput> = {},
): WorkItemInput => ({
  id,
  parentId: null,
  status,
  weight: 1,
  ...overrides,
});

describe("gateScore", () => {
  it("returns null when there are no gates", () => {
    expect(gateScore([])).toBeNull();
  });

  it("ignores NOT_APPLICABLE gates entirely rather than counting them as passed", () => {
    // The dishonest implementation counts N/A in the numerator and reports 1.0.
    const score = gateScore([
      { status: "NOT_APPLICABLE", weight: 1 },
      { status: "PENDING", weight: 1 },
    ]);
    expect(score).toBe(0);
  });

  it("returns null when every gate is inapplicable, falling back to status", () => {
    expect(gateScore([{ status: "NOT_APPLICABLE", weight: 1 }])).toBeNull();
  });

  it("weights gates rather than counting them", () => {
    const score = gateScore([
      { status: "PASSED", weight: 3 },
      { status: "PENDING", weight: 1 },
    ]);
    expect(score).toBe(0.75);
  });
});

describe("leafProgress", () => {
  it("never reports 1 for an item that is not COMPLETED, even with all gates passed", () => {
    const item = leaf("a", "VALIDATING", {
      gates: [
        { status: "PASSED", weight: 1 },
        { status: "PASSED", weight: 1 },
      ],
    });
    expect(leafProgress(item)).toBeLessThan(1);
    expect(leafProgress(item)).toBe(0.95);
  });

  it("reports 1 only for COMPLETED with no failing gate", () => {
    expect(leafProgress(leaf("a", "COMPLETED"))).toBe(1);
  });

  it("caps a COMPLETED item that still has a failing gate", () => {
    // Guards against marking something done while its evidence says otherwise.
    const item = leaf("a", "COMPLETED", {
      gates: [
        { status: "PASSED", weight: 1 },
        { status: "FAILED", weight: 1 },
      ],
    });
    expect(leafProgress(item)).toBe(0.5);
  });

  it("does not let a blocked item reach completion", () => {
    expect(leafProgress(leaf("a", "OPERATOR_REQUIRED"))).toBeLessThan(1);
    expect(leafProgress(leaf("a", "BLOCKED_EXTERNAL"))).toBeLessThan(1);
  });

  it("drops progress when an item is reopened", () => {
    const before = leafProgress(leaf("a", "COMPLETED"));
    const after = leafProgress(leaf("a", "REOPENED"));
    expect(after).toBeLessThan(before);
  });
});

describe("computeProgress", () => {
  it("derives a parent from its children and ignores the parent's own status", () => {
    // Parent claims COMPLETED while a child is untouched — the claim must lose.
    const items: WorkItemInput[] = [
      leaf("root", "COMPLETED"),
      leaf("a", "COMPLETED", { parentId: "root" }),
      leaf("b", "PLANNED", { parentId: "root" }),
    ];
    const results = computeProgress(items);
    expect(results.get("root")?.progress).toBe(0.5);
  });

  it("honours sibling weights when rolling up", () => {
    const items: WorkItemInput[] = [
      leaf("root", "IN_PROGRESS"),
      leaf("a", "COMPLETED", { parentId: "root", weight: 3 }),
      leaf("b", "PLANNED", { parentId: "root", weight: 1 }),
    ];
    expect(computeProgress(items).get("root")?.progress).toBe(0.75);
  });

  it("rolls up through several levels", () => {
    const items: WorkItemInput[] = [
      leaf("phase", "IN_PROGRESS"),
      leaf("m1", "IN_PROGRESS", { parentId: "phase" }),
      leaf("t1", "COMPLETED", { parentId: "m1" }),
      leaf("t2", "COMPLETED", { parentId: "m1" }),
      leaf("m2", "PLANNED", { parentId: "phase" }),
      leaf("t3", "PLANNED", { parentId: "m2" }),
    ];
    const results = computeProgress(items);
    expect(results.get("m1")?.progress).toBe(1);
    expect(results.get("m2")?.progress).toBe(0);
    expect(results.get("phase")?.progress).toBe(0.5);
  });

  it("counts leaves rather than intermediate nodes", () => {
    const items: WorkItemInput[] = [
      leaf("phase", "IN_PROGRESS"),
      leaf("m1", "IN_PROGRESS", { parentId: "phase" }),
      leaf("t1", "COMPLETED", { parentId: "m1" }),
      leaf("t2", "PLANNED", { parentId: "m1" }),
    ];
    const result = computeProgress(items).get("phase");
    expect(result?.leafCount).toBe(2);
    expect(result?.completedLeafCount).toBe(1);
  });

  it("terminates on a cyclic parent pointer instead of hanging", () => {
    const items: WorkItemInput[] = [
      leaf("a", "IN_PROGRESS", { parentId: "b" }),
      leaf("b", "IN_PROGRESS", { parentId: "a" }),
    ];
    expect(() => computeProgress(items)).not.toThrow();
  });
});

describe("overallProgress", () => {
  it("is 0 for an empty roadmap rather than NaN", () => {
    expect(overallProgress([])).toBe(0);
  });

  it("falls when a completed milestone is reopened (§55)", () => {
    const done: WorkItemInput[] = [
      leaf("p", "COMPLETED"),
      leaf("m1", "COMPLETED", { parentId: "p" }),
      leaf("m2", "COMPLETED", { parentId: "p" }),
    ];
    const regressed: WorkItemInput[] = [
      leaf("p", "COMPLETED"),
      leaf("m1", "COMPLETED", { parentId: "p" }),
      leaf("m2", "REOPENED", { parentId: "p" }),
    ];
    expect(overallProgress(done)).toBe(1);
    expect(overallProgress(regressed)).toBeLessThan(1);
  });

  it("cannot reach 1 while any leaf is incomplete", () => {
    const items: WorkItemInput[] = [
      leaf("p", "COMPLETED"),
      leaf("m1", "COMPLETED", { parentId: "p" }),
      leaf("m2", "VALIDATING", { parentId: "p" }),
    ];
    expect(overallProgress(items)).toBeLessThan(1);
  });
});

describe("blockersToCompletion", () => {
  it("permits completion when gates pass and children are done", () => {
    const item = leaf("a", "VALIDATING", { gates: [{ status: "PASSED", weight: 1 }] });
    expect(blockersToCompletion(item, [leaf("c", "COMPLETED")])).toEqual([]);
  });

  it("refuses completion while a gate is pending", () => {
    const item = leaf("a", "VALIDATING", { gates: [{ status: "PENDING", weight: 1 }] });
    expect(blockersToCompletion(item)).toContain("has a pending quality gate");
  });

  it("refuses completion while a child is unfinished", () => {
    expect(blockersToCompletion(leaf("a", "VALIDATING"), [leaf("c", "TESTING")]))
      .toHaveLength(1);
  });
});

describe("toPercent", () => {
  it("rounds to one decimal by default", () => {
    expect(toPercent(0.33333)).toBe(33.3);
  });
});
