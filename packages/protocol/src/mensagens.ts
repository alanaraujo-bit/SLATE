import { z } from "zod";

/**
 * Schemas de conteúdo por tipo de mensagem (ADR-0003).
 *
 * Estes schemas são a única definição: os tipos TypeScript são derivados deles,
 * então tipo e validação não conseguem divergir. Um tipo escrito à mão ao lado
 * de um schema separado sempre acaba mentindo.
 *
 * Regra que não pode ser quebrada: campo novo em mensagem existente é sempre
 * opcional. Se precisar ser obrigatório, é mensagem nova com capacidade nova.
 */

/** Escopos de autorização (ADR-0004 §4). Verificados no Agente, na execução. */
export const ESCOPOS = [
  "state.read",
  "deck.read",
  "deck.write",
  "action.execute",
  "action.define",
  "system.media",
  "system.input",
  "system.process",
  "system.shell",
] as const;

export type Escopo = (typeof ESCOPOS)[number];

/** Concedidos a um dispositivo recém-pareado. Nunca inclui shell (ADR-0004 §4). */
export const ESCOPOS_PADRAO: readonly Escopo[] = [
  "state.read",
  "deck.read",
  "action.execute",
  "system.media",
];

/**
 * Escopos que só podem ser habilitados na interface do Agente, no próprio PC.
 * Um dispositivo jamais amplia os próprios poderes.
 */
export const ESCOPOS_SOMENTE_NO_PC: readonly Escopo[] = [
  "system.shell",
  "action.define",
];

// ---------------------------------------------------------------------------
// Execução de ação
// ---------------------------------------------------------------------------

export const acaoExecutarPedido = z.object({
  actionId: z.string().min(1).max(128),
  /** Variáveis do fluxo. Limitado em tamanho para não virar vetor de abuso. */
  vars: z.record(z.string().max(64), z.string().max(2048)).optional(),
});

export type AcaoExecutarPedido = z.infer<typeof acaoExecutarPedido>;

export const acaoExecutarResposta = z.object({
  accepted: z.boolean(),
  /** Correlaciona a execução com os eventos de progresso e resultado. */
  executionId: z.string().min(1).max(64),
  rejectedReason: z
    .enum(["nao_encontrada", "escopo_negado", "ocupado", "invalida"])
    .optional(),
});

export const acaoProgresso = z.object({
  executionId: z.string().min(1).max(64),
  step: z.number().int().nonnegative(),
  totalSteps: z.number().int().positive().optional(),
  label: z.string().max(200).optional(),
});

export const acaoResultado = z.object({
  executionId: z.string().min(1).max(64),
  ok: z.boolean(),
  durationMs: z.number().int().nonnegative(),
  /**
   * Motivo legível quando falha. Nunca carrega saída bruta de shell: isso
   * vazaria conteúdo do PC para a tela sem necessidade (ADR-0004).
   */
  error: z.string().max(500).optional(),
});

// ---------------------------------------------------------------------------
// Estado transmitido pelo Agente
// ---------------------------------------------------------------------------

export const estadoSistema = z.object({
  cpu: z.number().min(0).max(100),
  memoria: z.number().min(0).max(100),
  /** Ausente quando não há leitura confiável — nunca zero fingindo dado. */
  gpu: z.number().min(0).max(100).optional(),
});

export const estadoMidia = z.object({
  playing: z.boolean(),
  title: z.string().max(200).optional(),
  artist: z.string().max(200).optional(),
  positionMs: z.number().int().nonnegative().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  volume: z.number().min(0).max(100).optional(),
});

export const contextoAlterado = z.object({
  /** Perfil que passou a valer. */
  profileId: z.string().min(1).max(128),
  /** Por que mudou — regra automática ou escolha do usuário. */
  reason: z.enum(["regra", "manual", "fallback"]),
  foregroundApp: z.string().max(200).optional(),
});

// ---------------------------------------------------------------------------
// Registro de tipos
// ---------------------------------------------------------------------------

/**
 * Mapa de tipo de mensagem para schema.
 *
 * Um tipo ausente daqui é recusado como `tipo_desconhecido` em vez de passar
 * sem validação — é o que garante que nenhum conteúdo chegue à aplicação sem
 * ter sido conferido.
 */
export const SCHEMAS = {
  "action.execute": acaoExecutarPedido,
  "action.execute.result": acaoExecutarResposta,
  "action.progress": acaoProgresso,
  "action.result": acaoResultado,
  "state.system": estadoSistema,
  "state.media": estadoMidia,
  "context.changed": contextoAlterado,
} as const;

export type TipoConhecido = keyof typeof SCHEMAS;

export function ehTipoConhecido(k: string): k is TipoConhecido {
  return Object.hasOwn(SCHEMAS, k);
}

/**
 * Valida o conteúdo de um envelope já validado estruturalmente.
 * Separado da validação do envelope porque são recusas diferentes: envelope
 * malformado é protocolo quebrado, conteúdo inválido é mensagem específica ruim.
 */
export function validarConteudo(
  k: string,
  conteudo: unknown,
): { ok: true; valor: unknown } | { ok: false; detalhe: string } {
  if (!ehTipoConhecido(k)) {
    return { ok: false, detalhe: `tipo desconhecido: ${k}` };
  }

  const resultado = SCHEMAS[k].safeParse(conteudo);
  return resultado.success
    ? { ok: true, valor: resultado.data }
    : { ok: false, detalhe: resultado.error.message };
}

/** Se um escopo autoriza um tipo de mensagem. Verificado no Agente. */
export const ESCOPO_EXIGIDO: Record<TipoConhecido, Escopo | null> = {
  "action.execute": "action.execute",
  "action.execute.result": null,
  "action.progress": null,
  "action.result": null,
  "state.system": "state.read",
  "state.media": "state.read",
  "context.changed": "state.read",
};

export function autoriza(k: TipoConhecido, escopos: readonly Escopo[]): boolean {
  const exigido = ESCOPO_EXIGIDO[k];
  return exigido === null || escopos.includes(exigido);
}
