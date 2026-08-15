"use client";

import { useState } from "react";
import type { NodeView } from "@/lib/snapshot";
import { T, formatarPercentual, plural } from "@/lib/rotulos";
import { GateList, ProgressRail, StatusChip } from "./primitives";

/**
 * Quais níveis já abrem expandidos.
 *
 * As fases abrem para que o formato do projeto apareça de imediato; o resto
 * começa fechado para a página abrir como um resumo, e não como uma parede de
 * texto. Uma fase em execução também abre seus marcos, porque é exatamente
 * isso que se procura ao abrir a página.
 */
function abertoPorPadrao(node: NodeView): boolean {
  if (node.kind === "PHASE") return true;
  if (node.kind === "MILESTONE") {
    // Qualquer marco já tocado abre: quem chega na página quer ver o que
    // andou. Marcos ainda intocados e marcos já 100% concluídos ficam
    // fechados, para a página abrir como resumo e não como parede de texto.
    return node.progress > 0 && node.progress < 1;
  }
  return false;
}

function tom(node: NodeView): "success" | "warning" | "danger" | undefined {
  if (node.status === "COMPLETED") return "success";
  if (node.status === "BLOCKED_EXTERNAL") return "danger";
  if (node.status === "OPERATOR_REQUIRED" || node.status === "REOPENED") return "warning";
  return undefined;
}

export function TreeNode({ node }: { node: NodeView }) {
  const [aberto, setAberto] = useState(() => abertoPorPadrao(node));
  const expansivel = node.children.length > 0 || !!node.description || node.gates.length > 0;

  return (
    <div className={`node node--${node.kind}`}>
      <button
        type="button"
        className="node__row"
        onClick={() => expansivel && setAberto((v) => !v)}
        aria-expanded={expansivel ? aberto : undefined}
        disabled={!expansivel}
      >
        <span className="node__twisty" data-open={aberto} aria-hidden="true">
          {expansivel ? "›" : "·"}
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
              tone={tom(node)}
              label={`Progresso de ${node.title}`}
            />
          </span>
          <span className="node__pct">{formatarPercentual(node.progress)}</span>
        </span>
      </button>

      {aberto && (node.description || node.gates.length > 0 || node.dependsOn.length > 0) && (
        <div className="node__detail">
          {node.description && <p className="node__description">{node.description}</p>}

          {node.dependsOn.length > 0 && (
            <p className="mono" style={{ color: "var(--text-tertiary)", marginTop: "0.5rem" }}>
              {T.dependeDe} {node.dependsOn.join(", ")}
            </p>
          )}

          <GateList gates={node.gates} />

          {node.leafCount > 0 && (
            <p className="mono" style={{ color: "var(--text-tertiary)", marginTop: "0.75rem" }}>
              {node.completedLeafCount} de {node.leafCount}{" "}
              {plural(node.leafCount, "tarefa concluída", "tarefas concluídas")}
            </p>
          )}
        </div>
      )}

      {aberto && node.children.length > 0 && (
        <div className="node__children">
          {node.children.map((filho) => (
            <TreeNode key={filho.id} node={filho} />
          ))}
        </div>
      )}
    </div>
  );
}

export function Tree({ nodes }: { nodes: NodeView[] }) {
  if (nodes.length === 0) {
    return <p className="notice">{T.semRoadmap}</p>;
  }
  return (
    <div>
      {nodes.map((node) => (
        <TreeNode key={node.id} node={node} />
      ))}
    </div>
  );
}
