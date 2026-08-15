import type { GateStatus, WorkKind, WorkStatus } from "@slate/db/schema";

/**
 * Todos os textos visíveis do Centro de Controle.
 *
 * Centralizados aqui para que nenhum componente carregue texto solto: mudar
 * uma palavra é mudar um lugar só. Os identificadores internos (status do
 * banco, chaves de item) continuam em inglês — são contrato de dados, não
 * interface.
 */

export const STATUS_ROTULO: Record<WorkStatus, string> = {
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

export const TIPO_ROTULO: Record<WorkKind, string> = {
  PHASE: "Fase",
  MILESTONE: "Marco",
  FEATURE: "Funcionalidade",
  TASK: "Tarefa",
  SUBTASK: "Subtarefa",
};

export const CRITERIO_ROTULO: Record<GateStatus, string> = {
  PENDING: "Pendente",
  PASSED: "Aprovado",
  FAILED: "Reprovado",
  NOT_APPLICABLE: "Não se aplica",
};

export const T = {
  produto: "SLATE",
  subtitulo: "Centro de Controle de Desenvolvimento",

  progressoGeral: "Progresso geral",
  itensDeTrabalho: "Itens de trabalho",
  tarefasConcluidas: "Tarefas concluídas",
  criteriosAprovados: "Critérios aprovados",
  emAndamento: "Em andamento",
  bloqueados: "Bloqueados",
  reabertos: "Reabertos",

  roadmap: "Plano de trabalho",
  tarefas: "tarefas",

  execucaoAtual: "Execução atual",
  ocioso: "Ocioso — nenhuma tarefa em execução no momento.",
  tarefa: "Tarefa",
  operacao: "Operação",
  branch: "Branch",
  commit: "Commit",
  ambiente: "Ambiente",
  atualizado: "Atualizado",

  acoesDoOperador: "Ações que dependem de você",
  nadaAguardando: "Nada aguardando você no momento.",
  abertas: "em aberto",
  bloqueiaProjeto: "Trava o projeto",
  naoBloqueia: "Não trava",
  porQue: "Por que",
  oQueFazer: "O que fazer",
  comoValidar: "Como validar",
  oQueBloqueia: "O que isso impede",
  jaFeito: "O que já foi feito",

  atividade: "Atividade",
  semAtividade: "Nenhuma atividade registrada ainda.",

  implantacoes: "Publicações",
  semImplantacoes: "Nenhuma publicação registrada.",

  aoVivo: "Ao vivo",
  reconectando: "Reconectando",
  semConexao: "Sem conexão",
  conexao: "Conexão",

  dependeDe: "depende de",
  progresso: "Progresso",

  semRoadmap: "Nenhum item no plano ainda. Rode a carga inicial para preencher.",
  indisponivel: "Centro de Controle indisponível",
  erroLeitura: "Não foi possível ler o estado do plano no banco de dados.",
} as const;

/** "há 5 min", "agora mesmo" — datas relativas em português. */
export function tempoRelativo(iso: string | null): string {
  if (!iso) return "—";
  const entao = new Date(iso).getTime();
  if (Number.isNaN(entao)) return "—";

  const segundos = Math.round((Date.now() - entao) / 1000);
  if (segundos < 45) return "agora mesmo";

  const minutos = Math.round(segundos / 60);
  if (minutos < 60) return `há ${minutos} min`;

  const horas = Math.round(minutos / 60);
  if (horas < 24) return `há ${horas} h`;

  const dias = Math.round(horas / 24);
  return dias === 1 ? "há 1 dia" : `há ${dias} dias`;
}

/** Percentual com vírgula decimal, como se escreve em português. */
export function formatarPercentual(valor: number): string {
  return `${(Math.round(valor * 1000) / 10).toFixed(1).replace(".", ",")}%`;
}

/** Pluralização simples para contagens. */
export function plural(n: number, singular: string, pluralForma: string): string {
  return n === 1 ? singular : pluralForma;
}
