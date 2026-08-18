import { z } from "zod";
import { hello } from "./handshake";
import { perfilEnergia } from "./energia";

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
  /**
   * Desligar, reiniciar, hibernar, suspender e bloquear (ADR-0006).
   *
   * Separado de `system.wake` porque não é o mesmo risco: acordar, no pior caso,
   * liga uma máquina à toa; desligar pode custar trabalho não salvo. Um escopo
   * só obrigaria quem quer o botão de ligar a conceder também o de desligar.
   */
  "system.power",
  /** Pedir a um Agente-ponte que emita o pacote que acorda outra máquina. */
  "system.wake",
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
  // Desligar o computador de alguém é autoridade de quem está na frente dele.
  // Pelo mesmo motivo de `system.process`: a conta revoga, mas nunca concede
  // (ADR-0004 §4). Vale também para acordar — quem não pode desligar aquele
  // computador também não decide sozinho que ele deve ligar.
  "system.power",
  "system.wake",
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
 * Uma posição dentro de um perfil do painel.
 *
 * O item carrega somente o identificador da ação. Nome, ícone e alvo continuam
 * vindo dos catálogos fechados ou da lista segura de programas do Agente.
 */
export const itemDePerfilDeck = z.object({
  actionId: z.string().min(1).max(128),
  pagina: z.number().int().min(0).max(9),
  ordem: z.number().int().min(0).max(199),
  cor: z.enum(CORES_ATALHO).optional(),
  tamanho: z.enum(["normal", "largo"]).optional(),
});

export type ItemDePerfilDeck = z.infer<typeof itemDePerfilDeck>;

/** Um painel salvo no computador e espelhado para a superfície móvel. */
export const perfilDeDeck = z.object({
  id: z.string().min(1).max(64),
  nome: z.string().min(1).max(28),
  cor: z.enum(CORES_ATALHO),
  colunasRetrato: z.number().int().min(2).max(3),
  colunasPaisagem: z.number().int().min(4).max(6),
  itens: z.array(itemDePerfilDeck).max(200),
});

export type PerfilDeDeck = z.infer<typeof perfilDeDeck>;

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
  /**
   * Ausente em Agentes antigos. A PWA preserva a grade clássica nesse caso,
   * então atualizar o site nunca quebra uma instalação que ficou para trás.
   */
  perfis: z.array(perfilDeDeck).max(12).optional(),
  perfilPadraoId: z.string().min(1).max(64).optional(),
  /** Fatia atual, começando em 1. Ausente quando a lista coube inteira. */
  parte: z.number().int().positive().max(100).optional(),
  total: z.number().int().positive().max(100).optional(),
});

export type DeckEstado = z.infer<typeof deckEstado>;

/**
 * O perfil de energia daquele computador, enviado depois do hello.
 *
 * Mensagem própria em vez de capacidades no hello porque as duas coisas têm
 * formatos incompatíveis: `capabilities` é uma lista de nomes, e isto é um mapa
 * de valores de três estados por máquina, com adaptador e impedimentos junto.
 * Espremer isso em nomes de capacidade daria strings como
 * `energia.acordar-de-hibernado-desconhecido`, que ninguém consegue evoluir.
 *
 * A capacidade `energia.controle` continua existindo, e é ela que diz se esta
 * mensagem chega — um Agente antigo não a anuncia e a PWA não espera perfil.
 */
export const energiaEstado = z.object({
  perfil: perfilEnergia,
  /**
   * Se este Agente pode servir de ponte para acordar outras máquinas da conta:
   * ele está online, tem rede utilizável e recebeu a concessão. Ausente em
   * Agentes que não sabem ser ponte.
   */
  podeSerPonte: z.boolean().optional(),
});

export type EnergiaEstado = z.infer<typeof energiaEstado>;

/**
 * O que o CALL está fazendo naquele computador agora.
 *
 * Mensagem própria, e não capacidades no hello, pelo mesmo motivo de
 * `energia.estado`: isto muda a toda hora — a pessoa entra num canal, sai, muta
 * — e capacidade é coisa que se negocia uma vez por sessão. Renegociar o hello
 * a cada aperto do microfone seria usar a ferramenta errada.
 *
 * A capacidade `call.controle` diz que aquele Agente **sabe** falar com o CALL;
 * `disponivel` aqui diz se ele está falando **agora**. As duas perguntas são
 * diferentes: um Agente novo com o CALL fechado responde sim para a primeira e
 * não para a segunda, e é exatamente esse caso que precisa ser explicável na
 * tela em vez de virar uma tecla que não faz nada.
 */
export const callEstado = z.object({
  /** Se o Agente está conectado ao CALL. Falso quando o CALL não está aberto. */
  disponivel: z.boolean(),
  /**
   * Se há um canal de voz com microfone aberto.
   *
   * Campo próprio, e não algo deduzido de `mudo`, porque é ele que decide se a
   * tecla existe: fora de uma chamada o CALL não tem o que mutar, e desenhar o
   * botão assim mesmo seria a mesma promessa vazia que o ADR-0006 proíbe na
   * grade de energia.
   */
  emChamada: z.boolean(),
  mudo: z.boolean(),
  transmitindo: z.boolean(),
});

export type CallEstado = z.infer<typeof callEstado>;

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
  "energia.estado": energiaEstado,
  "call.estado": callEstado,
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
  // Receber o perfil é `state.read`, que o pareamento concede — saber que
  // aquele computador hiberna não é poder hibernar. Quem autoriza *executar* é
  // `system.power`/`system.wake`, verificado na ação. Esconder o perfil de quem
  // não pode desligar deixaria a interface sem como explicar por que o botão
  // não está lá.
  "energia.estado": "state.read",
  // Mesmo raciocínio de `energia.estado`: saber que você está mudo não é poder
  // mutar. Quem autoriza mexer é `system.media`, verificado na ação — e é o
  // mesmo escopo do volume, porque mexer no microfone de uma chamada que já
  // está acontecendo é a mesma autoridade que mexer no que já está tocando.
  "call.estado": "state.read",
  "context.changed": "state.read",
};

export function autoriza(k: TipoConhecido, escopos: readonly Escopo[]): boolean {
  const exigido = ESCOPO_EXIGIDO[k];
  return exigido === null || escopos.includes(exigido);
}
