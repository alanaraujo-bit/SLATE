import { and, eq } from "drizzle-orm";
import type { Database } from "@slate/db";
import {
  activityEvents,
  executionState,
  qualityGates,
  workItems,
  type GateStatus,
  type WorkStatus,
} from "@slate/db/schema";
import { blockersToCompletion } from "@slate/db/progress";

/**
 * As operações que a CLI executa, separadas do processamento de argumentos.
 *
 * Estão aqui, e não dentro do `cli.ts`, para que possam ser testadas
 * diretamente contra um banco real. Testar a CLI por subprocesso testaria o
 * `parseArgs` junto e seria lento demais para cobrir os casos que importam —
 * que são as regras de recusa, não a leitura da linha de comando.
 */

export const STATUS_PT: Record<WorkStatus, string> = {
  PLANNED: "Planejado",
  READY: "Pronto",
  IN_PROGRESS: "Em andamento",
  TESTING: "Em teste",
  VALIDATING: "Validando",
  BLOCKED_EXTERNAL: "Bloqueado",
  OPERATOR_REQUIRED: "Precisa de você",
  COMPLETED: "Concluído",
  REOPENED: "Reaberto",
};

export const CRITERIO_PT: Record<GateStatus, string> = {
  PASSED: "Aprovado",
  FAILED: "Reprovado",
  PENDING: "Pendente",
  NOT_APPLICABLE: "Não se aplica",
};

export class ItemNaoEncontrado extends Error {
  constructor(chave: string) {
    super(`Item '${chave}' não encontrado.`);
    this.name = "ItemNaoEncontrado";
  }
}

export class ConclusaoRecusada extends Error {
  constructor(
    public readonly chave: string,
    public readonly motivos: string[],
  ) {
    super(`Recusando concluir ${chave}: ${motivos.join("; ")}`);
    this.name = "ConclusaoRecusada";
  }
}

export async function buscarItem(db: Database, projectId: string, chave: string) {
  const [item] = await db
    .select()
    .from(workItems)
    .where(and(eq(workItems.projectId, projectId), eq(workItems.key, chave)))
    .limit(1);
  if (!item) throw new ItemNaoEncontrado(chave);
  return item;
}

export async function registrarEvento(
  db: Database,
  projectId: string,
  tipo: string,
  titulo: string,
  opcoes: {
    detalhe?: string;
    severidade?: "INFO" | "SUCCESS" | "WARNING" | "ERROR";
    workItemId?: string;
  } = {},
): Promise<void> {
  await db.insert(activityEvents).values({
    projectId,
    workItemId: opcoes.workItemId ?? null,
    type: tipo,
    title: titulo,
    detail: opcoes.detalhe ?? null,
    severity: opcoes.severidade ?? "INFO",
  });
}

export async function definirStatus(
  db: Database,
  projectId: string,
  chave: string,
  status: WorkStatus,
  detalhe?: string,
) {
  const item = await buscarItem(db, projectId, chave);
  const agora = new Date();

  const patch: Partial<typeof workItems.$inferInsert> = { status, updatedAt: agora };
  if (status === "IN_PROGRESS" && !item.startedAt) patch.startedAt = agora;
  if (status === "COMPLETED") patch.completedAt = agora;
  // Reabrir precisa limpar a data de conclusão, senão o item fica marcado como
  // concluído em algum momento e reaberto agora, o que confunde relatório.
  if (status === "REOPENED") patch.completedAt = null;

  await db.update(workItems).set(patch).where(eq(workItems.id, item.id));

  await registrarEvento(
    db,
    projectId,
    `status.${status.toLowerCase()}`,
    `${item.key} — ${item.title}: ${STATUS_PT[item.status]} → ${STATUS_PT[status]}`,
    {
      detalhe,
      severidade:
        status === "COMPLETED"
          ? "SUCCESS"
          : status === "REOPENED" ||
              status === "BLOCKED_EXTERNAL" ||
              status === "OPERATOR_REQUIRED"
            ? "WARNING"
            : "INFO",
      workItemId: item.id,
    },
  );

  return { anterior: item.status, atual: status, item };
}

/**
 * Conclui um item, ou recusa dizendo por quê.
 *
 * A recusa é o ponto desta função. O mandato §57 proíbe otimizar o número às
 * custas da verdade, e a forma mais confiável de garantir isso é tornar o
 * estado desonesto inalcançável pela única ferramenta disponível — em vez de
 * depender de alguém lembrar de não fazer.
 */
export async function concluir(db: Database, projectId: string, chave: string) {
  const item = await buscarItem(db, projectId, chave);

  const criterios = await db
    .select()
    .from(qualityGates)
    .where(eq(qualityGates.workItemId, item.id));

  const filhos = await db
    .select()
    .from(workItems)
    .where(eq(workItems.parentId, item.id));

  const motivos = blockersToCompletion(
    {
      id: item.key,
      parentId: item.parentId,
      status: item.status,
      weight: item.weight,
      gates: criterios.map((c) => ({ status: c.status, weight: c.weight })),
    },
    filhos.map((f) => ({
      id: f.key,
      parentId: f.parentId,
      status: f.status,
      weight: f.weight,
    })),
  );

  if (motivos.length > 0) throw new ConclusaoRecusada(item.key, motivos);

  return definirStatus(db, projectId, chave, "COMPLETED");
}

export async function definirCriterio(
  db: Database,
  projectId: string,
  chave: string,
  chaveCriterio: string,
  status: GateStatus,
  evidencia?: string,
) {
  const item = await buscarItem(db, projectId, chave);

  const [criterio] = await db
    .select()
    .from(qualityGates)
    .where(
      and(eq(qualityGates.workItemId, item.id), eq(qualityGates.key, chaveCriterio)),
    )
    .limit(1);

  if (!criterio) {
    throw new Error(`Critério '${chaveCriterio}' não existe em ${item.key}.`);
  }

  await db
    .update(qualityGates)
    .set({
      status,
      evidence: evidencia ?? criterio.evidence,
      checkedAt: new Date(),
    })
    .where(eq(qualityGates.id, criterio.id));

  await registrarEvento(
    db,
    projectId,
    `gate.${status.toLowerCase()}`,
    `${item.key} — critério '${criterio.title}': ${CRITERIO_PT[status]}`,
    {
      detalhe: evidencia,
      severidade:
        status === "FAILED" ? "ERROR" : status === "PASSED" ? "SUCCESS" : "INFO",
      workItemId: item.id,
    },
  );

  return { anterior: criterio.status, atual: status };
}

export async function definirExecucao(
  db: Database,
  projectId: string,
  dados: {
    workItemId?: string;
    operacao?: string | null;
    branch?: string | null;
    commit?: string | null;
    ambiente?: string | null;
  },
) {
  const patch = {
    operation: dados.operacao ?? null,
    branch: dados.branch ?? null,
    commitSha: dados.commit ?? null,
    environment: dados.ambiente ?? null,
    updatedAt: new Date(),
    ...(dados.workItemId ? { currentWorkItemId: dados.workItemId } : {}),
  };

  await db
    .insert(executionState)
    .values({ projectId, ...patch })
    .onConflictDoUpdate({ target: executionState.projectId, set: patch });
}
