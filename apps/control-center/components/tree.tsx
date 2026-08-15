"use client";

import { useState } from "react";
import type { NodeView } from "@/lib/snapshot";
import { GateList, ProgressRail, StatusChip, formatPercent } from "./primitives";

/**
 * Which levels start expanded.
 *
 * Phases open so the shape of the project is visible immediately; everything
 * below stays closed so the page opens as a summary rather than a wall. A
 * phase that is actively being worked also opens its milestones, since that is
 * what a reader is looking for when they open the page.
 */
function defaultOpen(node: NodeView): boolean {
  if (node.kind === "PHASE") return true;
  if (node.kind === "MILESTONE") {
    return node.status === "IN_PROGRESS" || node.status === "TESTING";
  }
  return false;
}

function tone(node: NodeView): "success" | "warning" | "danger" | undefined {
  if (node.status === "COMPLETED") return "success";
  if (node.status === "BLOCKED_EXTERNAL") return "danger";
  if (node.status === "OPERATOR_REQUIRED" || node.status === "REOPENED") return "warning";
  return undefined;
}

export function TreeNode({ node }: { node: NodeView }) {
  const [open, setOpen] = useState(() => defaultOpen(node));
  const expandable = node.children.length > 0 || !!node.description || node.gates.length > 0;

  return (
    <div className={`node node--${node.kind}`}>
      <button
        type="button"
        className="node__row"
        onClick={() => expandable && setOpen((value) => !value)}
        aria-expanded={expandable ? open : undefined}
        disabled={!expandable}
      >
        <span className="node__twisty" data-open={open} aria-hidden="true">
          {expandable ? "›" : "·"}
        </span>

        <span className="node__main">
          <span className="node__key">{node.key}</span>
          <span className="node__title">{node.title}</span>
        </span>

        <span className="node__meta">
          <StatusChip status={node.status} />
          <span className="node__bar">
            <ProgressRail
              value={node.progress}
              tone={tone(node)}
              label={`${node.title} progress`}
            />
          </span>
          <span className="node__pct">{formatPercent(node.progress)}</span>
        </span>
      </button>

      {open && (node.description || node.gates.length > 0 || node.dependsOn.length > 0) && (
        <div className="node__detail">
          {node.description && <p className="node__description">{node.description}</p>}

          {node.dependsOn.length > 0 && (
            <p className="mono" style={{ color: "var(--text-tertiary)", marginTop: "0.5rem" }}>
              depends on {node.dependsOn.join(", ")}
            </p>
          )}

          <GateList gates={node.gates} />

          {node.leafCount > 0 && (
            <p className="mono" style={{ color: "var(--text-tertiary)", marginTop: "0.75rem" }}>
              {node.completedLeafCount} of {node.leafCount} tasks complete
            </p>
          )}
        </div>
      )}

      {open && node.children.length > 0 && (
        <div className="node__children">
          {node.children.map((child) => (
            <TreeNode key={child.id} node={child} />
          ))}
        </div>
      )}
    </div>
  );
}

export function Tree({ nodes }: { nodes: NodeView[] }) {
  if (nodes.length === 0) {
    return (
      <p className="notice">
        No roadmap items yet. Seed the roadmap to populate this view.
      </p>
    );
  }
  return (
    <div>
      {nodes.map((node) => (
        <TreeNode key={node.id} node={node} />
      ))}
    </div>
  );
}
