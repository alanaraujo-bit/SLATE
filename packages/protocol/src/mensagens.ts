import { z } from "zod";
import { hello } from "./handshake";

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
   *
   * `nullish`, e não `optional`: um Agente que serializa a ausência de erro
   * como `null` — em vez de omitir a chave — é indistinguível de sucesso, e
   * recusar a mensagem por causa disso deixava **toda ação bem-sucedida** sem
   * resposta. A pessoa via o comando funcionar no computador e, dez segundos
   * depois, "o computador não respondeu a tempo".
   *
   * Tolerar aqui é o certo mesmo depois de o Agente parar de mandar `null`: a
   * PWA se publica na hora e o Agente é um instalador que pode ficar meses
   * atrás. Ser rígido no que se envia e generoso no que se aceita é o que
   * mantém as duas pontas funcionando fora de sincronia.
   */
  error: z.string().max(500).nullish(),
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

/**
 * Cores possíveis de um atalho, espelhando `--s-control-*` do design system.
 *
 * Lista fechada, e é o que permite a cor virar `var(--s-control-${cor})` sem
 * revisão: uma cor livre vinda do canal seria conteúdo arbitrário entrando na
 * folha de estilo. O outro lado desta lista é `CORES` em
 * `apps/desktop/src-tauri/src/atalhos.rs`, e os dois precisam andar juntos.
 */
export const CORES_ATALHO = [
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "teal",
  "cyan",
  "blue",
  "indigo",
  "violet",
  "pink",
] as const;

export type CorAtalho = (typeof CORES_ATALHO)[number];

/**
 * Um atalho de programa, como ele viaja até o celular.
 *
 * **Não existe campo de caminho, e a ausência é a funcionalidade.** O Agente
 * guarda o caminho do executável em disco e traduz `programa.<id>` contra a
 * lista local; o celular recebe o suficiente para desenhar a tecla e devolver o
 * identificador. Acrescentar o caminho aqui entregaria a cada aparelho pareado
 * o mapa do disco do computador — exatamente o que o ADR-0004 impede.
 */
export const atalhoDeDeck = z.object({
  id: z.string().min(1).max(64),
  nome: z.string().min(1).max(40),
  cor: z.enum(CORES_ATALHO),
  /**
   * PNG do ícone do próprio executável, como data URI.
   *
   * O prefixo é exigido no schema porque este valor vai direto para o `src` de
   * uma imagem: sem a checagem, um `data:text/html` ou um `javascript:` vindo
   * de um Agente comprometido teria caminho até a renderização.
   */
  icone: z
    .string()
    .startsWith("data:image/png;base64,")
    .max(24_000)
    .optional(),
});

export type AtalhoDeDeck = z.infer<typeof atalhoDeDeck>;

/**
 * A lista de atalhos cadastrados no computador.
 *
 * Enviada pelo Agente logo depois do hello, e só a quem tem a concessão de
 * abrir programas naquela máquina.
 *
 * **Vem em fatias porque um DataChannel tem teto de mensagem.** Cem atalhos com
 * um PNG embutido em cada um passam com folga do que o SCTP entrega numa
 * mensagem só, e o sintoma de estourar não é um erro legível: é o canal morrer.
 * `parte`/`total` são opcionais porque a lista costuma caber numa mensagem — e
 * porque campo novo em mensagem existente é sempre opcional (ADR-0003).
 */
export const deckEstado = z.object({
  atalhos: z.array(atalhoDeDeck).max(100),
  /** Fatia atual, começando em 1. Ausente quando a lista coube inteira. */
  parte: z.number().int().positive().max(100).optional(),
  total: z.number().int().positive().max(100).optional(),
});

export type DeckEstado = z.infer<typeof deckEstado>;

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
  "session.hello": hello,
  "action.execute": acaoExecutarPedido,
  "action.execute.result": acaoExecutarResposta,
  "action.progress": acaoProgresso,
  "action.result": acaoResultado,
  "state.system": estadoSistema,
  "state.media": estadoMidia,
  "deck.estado": deckEstado,
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
  "session.hello": null,
  "action.execute": "action.execute",
  "action.execute.result": null,
  "action.progress": null,
  "action.result": null,
  "state.system": "state.read",
  "state.media": "state.read",
  // Ler o deck é `deck.read`, que o pareamento concede. Quem decide se os
  // atalhos aparecem é a capacidade `action.atalhos`, anunciada por par — este
  // escopo só diz que a lista pode ser recebida, não que ela pode ser aberta.
  "deck.estado": "deck.read",
  "context.changed": "state.read",
};

export function autoriza(k: TipoConhecido, escopos: readonly Escopo[]): boolean {
  const exigido = ESCOPO_EXIGIDO[k];
  return exigido === null || escopos.includes(exigido);
}
