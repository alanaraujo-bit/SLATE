import type { GateStatus, WorkStatus } from "./schema";

/**
 * Progress computation for the SLATE roadmap.
 *
 * Mandate §23 forbids hand-written percentages, and §57 forbids optimising the
 * number at the expense of the truth. Every rule here exists to make an
 * inflated figure impossible to produce:
 *
 *  - A leaf's progress comes from its quality gates when it has any, because
 *    gates are the actual evidence of doneness. Status alone is a claim; a
 *    passing gate is a fact.
 *  - Only COMPLETED yields 1. Every other status is capped strictly below,
 *    even with all gates passing, so "all gates green" and "done" stay
 *    distinct states.
 *  - A FAILED gate caps the item hard, regardless of its siblings.
 *  - Parents ignore their own status entirely and derive from children, so a
 *    branch cannot be marked complete over unfinished work beneath it.
 */

/**
 * Fraction of work represented by each status for a leaf without gates.
 *
 * BLOCKED_EXTERNAL and OPERATOR_REQUIRED deliberately sit mid-scale: real work
 * was done up to the point of the block, and pretending otherwise would
 * understate progress just as dishonestly as inflating it. They can never
 * reach 1 — a blocked item is not a finished item (§29).
 */
export const STATUS_PROGRESS: Record<WorkStatus, number> = {
  PLANNED: 0,
  READY: 0,
  IN_PROGRESS: 0.4,
  TESTING: 0.7,
  VALIDATING: 0.85,
  BLOCKED_EXTERNAL: 0.5,
  OPERATOR_REQUIRED: 0.5,
  COMPLETED: 1,
  REOPENED: 0.25,
};

/** Ceiling applied to a non-COMPLETED item however well its gates score. */
const INCOMPLETE_CEILING = 0.95;

/** Ceiling applied when any gate has failed outright. */
const FAILED_GATE_CEILING = 0.5;

export interface GateInput {
  status: GateStatus;
  weight: number;
}

export interface WorkItemInput {
  id: string;
  parentId: string | null;
  status: WorkStatus;
  weight: number;
  gates?: GateInput[];
}

export interface ProgressResult {
  /** 0..1 */
  progress: number;
  /** Leaf count beneath and including this item. */
  leafCount: number;
  completedLeafCount: number;
}

/**
 * Gate score for a single item, or `null` when it has no applicable gates.
 * NOT_APPLICABLE gates are excluded from both numerator and denominator so
 * marking a gate inapplicable never inflates the score — it only shrinks the
 * set of things being measured.
 */
export function gateScore(gates: readonly GateInput[]): number | null {
  const applicable = gates.filter((g) => g.status !== "NOT_APPLICABLE");
  if (applicable.length === 0) return null;

  const total = applicable.reduce((sum, g) => sum + g.weight, 0);
  if (total <= 0) return null;

  const passed = applicable
    .filter((g) => g.status === "PASSED")
    .reduce((sum, g) => sum + g.weight, 0);

  return passed / total;
}

export function hasFailedGate(gates: readonly GateInput[]): boolean {
  return gates.some((g) => g.status === "FAILED");
}

/** Progress of a leaf node, from its gates when present, else from its status. */
export function leafProgress(item: WorkItemInput): number {
  const gates = item.gates ?? [];
  const score = gateScore(gates);

  let value = score ?? STATUS_PROGRESS[item.status];

  // A COMPLETED item with a failing gate is a contradiction. Resolve it
  // against the evidence, not the label.
  if (hasFailedGate(gates)) {
    value = Math.min(value, FAILED_GATE_CEILING);
  } else if (item.status === "COMPLETED") {
    // Gates all pass (or there are none) and the item is declared complete.
    value = 1;
  }

  if (item.status !== "COMPLETED") {
    value = Math.min(value, INCOMPLETE_CEILING);
  }

  return clamp01(value);
}

/**
 * Computes progress for every item in a tree, bottom-up.
 *
 * Accepts a flat list in any order; children are matched by `parentId`. Items
 * whose parent is absent from the list are treated as roots.
 */
export function computeProgress(
  items: readonly WorkItemInput[],
): Map<string, ProgressResult> {
  const byId = new Map(items.map((i) => [i.id, i]));
  const childrenOf = new Map<string, WorkItemInput[]>();

  for (const item of items) {
    const parentId = item.parentId;
    if (parentId === null || !byId.has(parentId)) continue;
    const bucket = childrenOf.get(parentId);
    if (bucket) bucket.push(item);
    else childrenOf.set(parentId, [item]);
  }

  const results = new Map<string, ProgressResult>();
  const visiting = new Set<string>();

  const resolve = (item: WorkItemInput): ProgressResult => {
    const cached = results.get(item.id);
    if (cached) return cached;

    // Defensive: a cycle would otherwise recurse forever. Data should never
    // contain one, but a corrupted parent pointer must not hang the page.
    if (visiting.has(item.id)) {
      const fallback: ProgressResult = {
        progress: 0,
        leafCount: 1,
        completedLeafCount: 0,
      };
      results.set(item.id, fallback);
      return fallback;
    }
    visiting.add(item.id);

    const children = childrenOf.get(item.id) ?? [];
    let result: ProgressResult;

    if (children.length === 0) {
      const progress = leafProgress(item);
      result = {
        progress,
        leafCount: 1,
        completedLeafCount: item.status === "COMPLETED" ? 1 : 0,
      };
    } else {
      let weighted = 0;
      let totalWeight = 0;
      let leafCount = 0;
      let completedLeafCount = 0;

      for (const child of children) {
        const childResult = resolve(child);
        const weight = child.weight > 0 ? child.weight : 1;
        weighted += childResult.progress * weight;
        totalWeight += weight;
        leafCount += childResult.leafCount;
        completedLeafCount += childResult.completedLeafCount;
      }

      result = {
        progress: totalWeight > 0 ? clamp01(weighted / totalWeight) : 0,
        leafCount,
        completedLeafCount,
      };
    }

    visiting.delete(item.id);
    results.set(item.id, result);
    return result;
  };

  for (const item of items) resolve(item);
  return results;
}

/** Weighted overall progress across the roots of the tree. */
export function overallProgress(items: readonly WorkItemInput[]): number {
  const byId = new Map(items.map((i) => [i.id, i]));
  const roots = items.filter((i) => i.parentId === null || !byId.has(i.parentId));
  if (roots.length === 0) return 0;

  const results = computeProgress(items);
  let weighted = 0;
  let totalWeight = 0;

  for (const root of roots) {
    const weight = root.weight > 0 ? root.weight : 1;
    weighted += (results.get(root.id)?.progress ?? 0) * weight;
    totalWeight += weight;
  }

  return totalWeight > 0 ? clamp01(weighted / totalWeight) : 0;
}

/**
 * Whether an item is permitted to transition to COMPLETED (§31, §57).
 * Returns the reasons it may not, empty when it may.
 */
export function blockersToCompletion(
  item: WorkItemInput,
  children: readonly WorkItemInput[] = [],
): string[] {
  const reasons: string[] = [];

  for (const gate of item.gates ?? []) {
    if (gate.status === "PENDING") reasons.push("tem critério de qualidade pendente");
    if (gate.status === "FAILED") reasons.push("tem critério de qualidade reprovado");
  }

  for (const child of children) {
    if (child.status !== "COMPLETED") {
      reasons.push(`o item filho ${child.id} não está concluído (${child.status})`);
    }
  }

  return [...new Set(reasons)];
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function toPercent(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round(value * 100 * factor) / factor;
}
