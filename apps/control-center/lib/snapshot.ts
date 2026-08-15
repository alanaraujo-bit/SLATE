import { desc, eq } from "drizzle-orm";
import { getDb } from "@slate/db";
import {
  activityEvents,
  dependencies,
  deployments,
  executionState,
  operatorActions,
  projects,
  qualityGates,
  workItems,
  type GateStatus,
  type WorkKind,
  type WorkStatus,
} from "@slate/db/schema";
import { computeProgress, overallProgress, type WorkItemInput } from "@slate/db/progress";

export const PROJECT_SLUG = "slate";

export interface GateView {
  key: string;
  title: string;
  status: GateStatus;
  evidence: string | null;
  checkedAt: string | null;
}

export interface NodeView {
  id: string;
  key: string;
  kind: WorkKind;
  title: string;
  description: string | null;
  status: WorkStatus;
  weight: number;
  progress: number;
  leafCount: number;
  completedLeafCount: number;
  gates: GateView[];
  dependsOn: string[];
  children: NodeView[];
  startedAt: string | null;
  completedAt: string | null;
}

export interface Snapshot {
  project: { name: string; version: string; description: string | null };
  overall: number;
  counts: Record<WorkStatus, number>;
  totals: { items: number; leaves: number; completedLeaves: number; gates: number; gatesPassed: number };
  tree: NodeView[];
  execution: {
    itemKey: string | null;
    itemTitle: string | null;
    operation: string | null;
    branch: string | null;
    commitSha: string | null;
    environment: string | null;
    updatedAt: string | null;
  } | null;
  activity: Array<{
    id: string;
    type: string;
    severity: string;
    title: string;
    detail: string | null;
    createdAt: string;
  }>;
  operatorActions: Array<{
    code: string;
    title: string;
    status: string;
    projectBlocked: boolean;
    impact: string | null;
    blocks: string | null;
    why: string | null;
    whatToDo: string | null;
    howToValidate: string | null;
    alreadyCompleted: string | null;
    whatHappensAfter: string | null;
  }>;
  deployments: Array<{
    environment: string;
    target: string;
    url: string | null;
    status: string;
    commitSha: string | null;
    createdAt: string;
  }>;
  generatedAt: string;
  /** Changes whenever anything above could have changed. Used by the stream. */
  revision: string;
}

const EMPTY_COUNTS: Record<WorkStatus, number> = {
  PLANNED: 0,
  READY: 0,
  IN_PROGRESS: 0,
  TESTING: 0,
  VALIDATING: 0,
  BLOCKED_EXTERNAL: 0,
  OPERATOR_REQUIRED: 0,
  COMPLETED: 0,
  REOPENED: 0,
};

const iso = (value: Date | null) => (value ? value.toISOString() : null);

export async function loadSnapshot(): Promise<Snapshot> {
  const db = getDb();

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.slug, PROJECT_SLUG))
    .limit(1);

  if (!project) {
    throw new Error(
      `Project '${PROJECT_SLUG}' is missing from the database. Seed it before serving.`,
    );
  }

  const [items, gates, deps, events, actions, deploys, execRows] = await Promise.all([
    db.select().from(workItems).where(eq(workItems.projectId, project.id)),
    db.select().from(qualityGates),
    db.select().from(dependencies),
    db
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.projectId, project.id))
      .orderBy(desc(activityEvents.createdAt))
      .limit(40),
    db.select().from(operatorActions).where(eq(operatorActions.projectId, project.id)),
    db
      .select()
      .from(deployments)
      .where(eq(deployments.projectId, project.id))
      .orderBy(desc(deployments.createdAt))
      .limit(10),
    db.select().from(executionState).where(eq(executionState.projectId, project.id)).limit(1),
  ]);

  const itemIds = new Set(items.map((item) => item.id));
  const keyById = new Map(items.map((item) => [item.id, item.key]));

  const gatesByItem = new Map<string, GateView[]>();
  for (const gate of gates) {
    if (!itemIds.has(gate.workItemId)) continue;
    const view: GateView = {
      key: gate.key,
      title: gate.title,
      status: gate.status,
      evidence: gate.evidence,
      checkedAt: iso(gate.checkedAt),
    };
    const bucket = gatesByItem.get(gate.workItemId);
    if (bucket) bucket.push(view);
    else gatesByItem.set(gate.workItemId, [view]);
  }

  const depsByItem = new Map<string, string[]>();
  for (const dep of deps) {
    if (!itemIds.has(dep.workItemId)) continue;
    const key = keyById.get(dep.dependsOnId);
    if (!key) continue;
    const bucket = depsByItem.get(dep.workItemId);
    if (bucket) bucket.push(key);
    else depsByItem.set(dep.workItemId, [key]);
  }

  const progressInputs: WorkItemInput[] = items.map((item) => ({
    id: item.id,
    parentId: item.parentId,
    status: item.status,
    weight: item.weight,
    gates: gatesByItem.get(item.id)?.map((g) => ({ status: g.status, weight: 1 })),
  }));

  const progressById = computeProgress(progressInputs);

  const childrenOf = new Map<string, typeof items>();
  for (const item of items) {
    if (!item.parentId || !itemIds.has(item.parentId)) continue;
    const bucket = childrenOf.get(item.parentId);
    if (bucket) bucket.push(item);
    else childrenOf.set(item.parentId, [item]);
  }

  /**
   * Status exibido para um nó que tem filhos.
   *
   * O progresso de um pai já vem inteiramente dos filhos, mas o *status*
   * gravado é do próprio nó — e a CLI move tarefas, não marcos. O resultado é
   * um marco marcado "Planejado" exibindo 46% de progresso, o que lê como erro.
   * Aqui o status mostrado é derivado dos filhos pela mesma lógica do
   * progresso, mantendo os dois números coerentes na tela. Nada é gravado no
   * banco: isto é apresentação, não estado.
   */
  const statusDerivado = (filhos: NodeView[]): WorkStatus => {
    if (filhos.length === 0) return "PLANNED";
    if (filhos.every((f) => f.status === "COMPLETED")) return "COMPLETED";
    if (filhos.some((f) => f.status === "REOPENED")) return "REOPENED";
    if (filhos.some((f) => f.status === "BLOCKED_EXTERNAL")) return "BLOCKED_EXTERNAL";

    const emMovimento = filhos.some(
      (f) => f.status !== "PLANNED" && f.status !== "READY",
    );
    if (emMovimento) return "IN_PROGRESS";

    if (filhos.some((f) => f.status === "OPERATOR_REQUIRED")) return "OPERATOR_REQUIRED";
    return "PLANNED";
  };

  const build = (item: (typeof items)[number]): NodeView => {
    const result = progressById.get(item.id);
    const children = (childrenOf.get(item.id) ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map(build);

    return {
      id: item.id,
      key: item.key,
      kind: item.kind,
      title: item.title,
      description: item.description,
      status: children.length > 0 ? statusDerivado(children) : item.status,
      weight: item.weight,
      progress: result?.progress ?? 0,
      leafCount: result?.leafCount ?? 0,
      completedLeafCount: result?.completedLeafCount ?? 0,
      gates: gatesByItem.get(item.id) ?? [],
      dependsOn: depsByItem.get(item.id) ?? [],
      children,
      startedAt: iso(item.startedAt),
      completedAt: iso(item.completedAt),
    };
  };

  const tree = items
    .filter((item) => item.parentId === null)
    .sort((a, b) => a.position - b.position)
    .map(build);

  const counts = { ...EMPTY_COUNTS };
  for (const item of items) counts[item.status] += 1;

  const exec = execRows[0];
  const execItemKey = exec?.currentWorkItemId ? keyById.get(exec.currentWorkItemId) ?? null : null;
  const execItem = items.find((item) => item.id === exec?.currentWorkItemId);

  const relevantGates = gates.filter((gate) => itemIds.has(gate.workItemId));

  // A cheap fingerprint of everything mutable, so the stream can detect change
  // without diffing whole payloads.
  const revision = [
    items.reduce((max, i) => Math.max(max, i.updatedAt.getTime()), 0),
    relevantGates.reduce((max, g) => Math.max(max, g.checkedAt?.getTime() ?? 0), 0),
    events[0]?.createdAt.getTime() ?? 0,
    exec?.updatedAt.getTime() ?? 0,
    deploys[0]?.createdAt.getTime() ?? 0,
    items.length,
    relevantGates.length,
  ].join("-");

  return {
    project: {
      name: project.name,
      version: project.version,
      description: project.description,
    },
    overall: overallProgress(progressInputs),
    counts,
    totals: {
      items: items.length,
      leaves: tree.reduce((sum, node) => sum + node.leafCount, 0),
      completedLeaves: tree.reduce((sum, node) => sum + node.completedLeafCount, 0),
      gates: relevantGates.length,
      gatesPassed: relevantGates.filter((g) => g.status === "PASSED").length,
    },
    tree,
    execution: exec
      ? {
          itemKey: execItemKey,
          itemTitle: execItem?.title ?? null,
          operation: exec.operation,
          branch: exec.branch,
          commitSha: exec.commitSha,
          environment: exec.environment,
          updatedAt: iso(exec.updatedAt),
        }
      : null,
    activity: events.map((event) => ({
      id: event.id,
      type: event.type,
      severity: event.severity,
      title: event.title,
      detail: event.detail,
      createdAt: event.createdAt.toISOString(),
    })),
    operatorActions: actions
      .slice()
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((action) => ({
        code: action.code,
        title: action.title,
        status: action.status,
        projectBlocked: action.projectBlocked,
        impact: action.impact,
        blocks: action.blocks,
        why: action.why,
        whatToDo: action.whatToDo,
        howToValidate: action.howToValidate,
        alreadyCompleted: action.alreadyCompleted,
        whatHappensAfter: action.whatHappensAfter,
      })),
    deployments: deploys.map((deploy) => ({
      environment: deploy.environment,
      target: deploy.target,
      url: deploy.url,
      status: deploy.status,
      commitSha: deploy.commitSha,
      createdAt: deploy.createdAt.toISOString(),
    })),
    generatedAt: new Date().toISOString(),
    revision,
  };
}
