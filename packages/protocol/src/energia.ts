import { z } from "zod";

/**
 * Energia remota (ADR-0006).
 *
 * Dois assuntos que parecem um só e não são:
 *
 * - **Desligar** acontece com o Agente online. É ação comum, e por isso mora no
 *   registro de ações como qualquer outra.
 * - **Acordar** acontece com o Agente offline, por definição. Ninguém do outro
 *   lado responde, então o retorno não pode ser a resposta do alvo — é a
 *   reconexão dele, minutos depois.
 *
 * O fato que governa este arquivo inteiro: **um navegador não emite pacote UDP
 * nem quadro de broadcast.** Acordar exige sempre um componente dentro da rede
 * do alvo. Estar na mesma rede não ajuda a PWA — para o navegador, "em casa" e
 * "no 4G" são igualmente impossíveis, e pelo mesmo motivo.
 */

// ---------------------------------------------------------------------------
// Ações
// ---------------------------------------------------------------------------

/**
 * Os identificadores das ações de energia.
 *
 * Em português como o restante do registro (`midia.reproduzir-pausar`,
 * `volume.aumentar`) — os *escopos* seguem em inglês porque são contrato de
 * dados guardado no banco, e não interface.
 *
 * O outro lado desta lista é o `match` em
 * `apps/desktop/src-tauri/src/acoes.rs`. Uma tecla aqui sem a ação
 * correspondente lá vira um botão que responde "ação não encontrada", que é pior
 * do que não ter o botão.
 */
export const ACOES_ENERGIA = {
  bloquear: "sistema.bloquear",
  suspender: "sistema.suspender",
  hibernar: "sistema.hibernar",
  reiniciar: "sistema.reiniciar",
  desligar: "sistema.desligar",
  cancelarDesligamento: "sistema.cancelar-desligamento",
  /** Vai para a **ponte**, não para o alvo: o alvo está desligado. */
  acordar: "sistema.acordar",
  /** Leva a máquina ao estado de Pronto para Retorno que o perfil escolheu. */
  prontoParaRetorno: "sistema.pronto-para-retorno",
} as const;

export type AcaoEnergia = (typeof ACOES_ENERGIA)[keyof typeof ACOES_ENERGIA];

/**
 * As ações que podem custar trabalho não salvo.
 *
 * Usada pela PWA para decidir quais exigem confirmação deliberada, e é lista
 * própria em vez de uma marca em cada controle porque a regra é do domínio, não
 * da tela: outra superfície que apareça depois herda a mesma proteção sem
 * ninguém precisar lembrar.
 */
export const ACOES_ENERGIA_DESTRUTIVAS: readonly AcaoEnergia[] = [
  ACOES_ENERGIA.reiniciar,
  ACOES_ENERGIA.desligar,
  ACOES_ENERGIA.hibernar,
  ACOES_ENERGIA.prontoParaRetorno,
];

// ---------------------------------------------------------------------------
// Perfil de capacidades
// ---------------------------------------------------------------------------

/**
 * O que se sabe sobre uma capacidade daquela máquina.
 *
 * Três valores, e o terceiro é o que sustenta a promessa do ADR-0006 de não
 * fingir suporte: `desconhecido` **não** é sinônimo de `nao`. Uma máquina cujo
 * autoteste nunca rodou não suporta menos do que outra — nós é que não sabemos,
 * e a interface precisa poder dizer isso em vez de escolher um chute.
 */
export const suporte = z.enum(["sim", "nao", "desconhecido"]);
export type Suporte = z.infer<typeof suporte>;

/**
 * Níveis de compatibilidade (ADR-0006 §5).
 *
 * Derivados de capacidade medida, nunca de modelo de máquina.
 */
export const NIVEIS_ENERGIA = ["COMPLETO", "PADRAO", "LIMITADO"] as const;
export type NivelEnergia = (typeof NIVEIS_ENERGIA)[number];

/**
 * O estado de menor consumo que aquela máquina consegue manter preservando
 * retorno confiável. `nenhum` é resposta legítima e frequente.
 */
export const estadoProntoParaRetorno = z.enum(["desligado", "hibernado", "nenhum"]);
export type EstadoProntoParaRetorno = z.infer<typeof estadoProntoParaRetorno>;

export const perfilEnergia = z.object({
  /** Bloquear existe em todo Windows; está aqui para a interface não presumir. */
  bloquear: suporte,
  suspender: suporte,
  hibernar: suporte,
  reiniciar: suporte,
  desligar: suporte,
  /** Só faz sentido durante a contagem de um desligamento agendado. */
  cancelarDesligamento: suporte,

  /** O adaptador aceita o pacote mágico e o Windows deixa ele acordar a máquina. */
  acordarPelaRede: suporte,
  acordarDeSuspenso: suporte,
  acordarDeHibernado: suporte,
  /**
   * O caso que decide entre COMPLETO e PADRÃO, e o mais difícil de determinar:
   * depende de firmware, e nenhuma leitura do Windows responde com confiança.
   * Fica `desconhecido` até um autoteste real, e é assim que deve ser.
   */
  acordarDeDesligado: suporte,

  /** Escolhido a partir do que está acima; ver `escolherProntoParaRetorno`. */
  prontoParaRetorno: estadoProntoParaRetorno,
  nivel: z.enum(NIVEIS_ENERGIA),

  /**
   * Nome do adaptador de rede ativo, para a tela de diagnóstico.
   *
   * **Não há endereço físico neste schema, e a ausência é a funcionalidade** —
   * mesma regra de `atalhoDeDeck` não carregar caminho. O endereço mora na
   * nuvem e é entregue só à ponte, autenticada e restrita à própria conta. Sem
   * isso, todo aparelho pareado receberia o mapa de endereços físicos da casa e
   * poderia mandar um Agente emitir quadros para qualquer um deles (ADR-0006).
   */
  adaptador: z.string().max(120).optional(),
  tipoDeAdaptador: z.enum(["ethernet", "wifi", "desconhecido"]).optional(),

  /**
   * Por que acordar não está disponível, quando não está. Lista fechada: a
   * interface precisa dizer o que fazer, e cada motivo tem um texto e uma ação
   * diferentes.
   */
  impedimentos: z
    .array(
      z.enum([
        "hibernacao-desligada",
        "adaptador-sem-permissao",
        "adaptador-nao-suporta",
        "firmware-precisa-de-ajuste",
        "sem-ponte-na-rede",
        "nao-testado",
      ]),
    )
    .max(6)
    .optional(),

  /** Milissegundos desde a época do último autoteste; ausente se nunca rodou. */
  testadoEm: z.number().int().nonnegative().optional(),
});

export type PerfilEnergia = z.infer<typeof perfilEnergia>;

/**
 * Escolhe o estado de Pronto para Retorno a partir do perfil (ADR-0006 §4).
 *
 * A ordem não é arbitrária: desligado consome menos que hibernado, então ele
 * vem primeiro **quando o retorno a partir dele for comprovado**. `desconhecido`
 * não serve — apostar num retorno não testado é exatamente a promessa que o
 * ADR-0006 proíbe, e o custo do erro é uma máquina que não liga mais pelo
 * celular.
 */
export function escolherProntoParaRetorno(
  perfil: Pick<
    PerfilEnergia,
    "acordarPelaRede" | "acordarDeDesligado" | "acordarDeHibernado" | "hibernar" | "desligar"
  >,
): EstadoProntoParaRetorno {
  if (perfil.acordarPelaRede !== "sim") return "nenhum";

  if (perfil.acordarDeDesligado === "sim" && perfil.desligar === "sim") {
    return "desligado";
  }
  if (perfil.acordarDeHibernado === "sim" && perfil.hibernar === "sim") {
    return "hibernado";
  }
  return "nenhum";
}

/**
 * O nível de compatibilidade daquela máquina.
 *
 * `temPonte` entra no cálculo porque COMPLETO afirma que a pessoa consegue
 * acordar de onde estiver, e isso é falso sem alguém na rede para emitir o
 * pacote — por melhor que seja o hardware. Uma máquina impecável numa casa com
 * um computador só é honestamente PADRÃO, não COMPLETO.
 */
export function nivelDeCompatibilidade(
  perfil: Pick<
    PerfilEnergia,
    "acordarPelaRede" | "acordarDeDesligado" | "acordarDeHibernado" | "hibernar" | "desligar"
  >,
  temPonte: boolean,
): NivelEnergia {
  const estado = escolherProntoParaRetorno(perfil);
  if (estado === "nenhum") return "LIMITADO";
  if (estado === "desligado" && temPonte) return "COMPLETO";
  return "PADRAO";
}

// ---------------------------------------------------------------------------
// Máquina de estados do acordar
// ---------------------------------------------------------------------------

/**
 * Os estados por que passa um pedido de acordar.
 *
 * Em maiúsculas e em inglês como `ESTADOS_CONEXAO`, porque são a mesma classe de
 * coisa: estado que a interface precisa saber explicar (§37).
 *
 * **`WAKE_SENT` não é `ONLINE`.** É o erro clássico desta funcionalidade, e o
 * motivo de a máquina de estados existir: emitir o pacote prova apenas que o
 * quadro saiu da placa de rede da ponte. A máquina pode não ter acordado, pode
 * ter acordado e travado no POST, pode estar sem rede. Só a reconexão do Agente
 * prova que ligou.
 */
export const ESTADOS_ACORDAR = [
  /** A pessoa tocou; ainda não se sabe se há ponte disponível. */
  "WAKE_REQUESTED",
  /** A ponte confirmou que emitiu o pacote. */
  "WAKE_SENT",
  /** Contando o tempo de boot do computador. */
  "WAITING_FOR_DEVICE",
  /** O Agente do alvo apareceu na sinalização e está estabelecendo sessão. */
  "AGENT_CONNECTING",
  /** Sessão viva com o alvo. É o único estado que afirma que o PC ligou. */
  "ONLINE",
  /** Não há Agente online naquela rede para emitir o pacote (ADR-0006). */
  "NO_BRIDGE",
  /** Aquela máquina não sabe acordar pela rede; não é falha, é ausência. */
  "UNSUPPORTED",
  /** O pacote saiu e o computador não voltou dentro da janela. */
  "TIMED_OUT",
  /** A ponte não conseguiu emitir, ou recusou. */
  "FAILED",
] as const;

export type EstadoAcordar = (typeof ESTADOS_ACORDAR)[number];

/** Estados a partir dos quais nada mais acontece sem um novo pedido. */
export const ESTADOS_ACORDAR_FINAIS: readonly EstadoAcordar[] = [
  "ONLINE",
  "NO_BRIDGE",
  "UNSUPPORTED",
  "TIMED_OUT",
  "FAILED",
];

export function acordarTerminou(estado: EstadoAcordar): boolean {
  return ESTADOS_ACORDAR_FINAIS.includes(estado);
}

export type EventoAcordar =
  | { tipo: "pedido" }
  | { tipo: "sem-ponte" }
  | { tipo: "sem-suporte" }
  | { tipo: "ponte-emitiu" }
  | { tipo: "ponte-falhou" }
  | { tipo: "alvo-na-sinalizacao" }
  | { tipo: "sessao-aberta" }
  | { tipo: "tempo-esgotado" };

/**
 * A transição da máquina de estados do acordar.
 *
 * Função pura e exaustiva de propósito: é o único lugar onde a regra mora, e
 * pode ser exercitada inteira sem rede, sem hardware e sem esperar dois minutos
 * de boot.
 *
 * Duas propriedades que os testes fixam:
 *
 * - **Estado final não volta atrás.** Um evento atrasado que chegue depois do
 *   tempo esgotado não ressuscita a espera, e o `ONLINE` de uma tentativa não é
 *   desfeito por um `tempo-esgotado` da tentativa anterior.
 * - **`sessao-aberta` vence de qualquer estado não final.** Se o computador
 *   voltou, pouco importa por qual caminho: quem tem razão é a sessão viva.
 */
export function transicaoAcordar(
  atual: EstadoAcordar,
  evento: EventoAcordar,
): EstadoAcordar {
  if (acordarTerminou(atual)) return atual;

  // A sessão viva é a prova, e ela vale mesmo se algum evento intermediário se
  // perdeu — o alvo pode voltar sem que a ponte tenha confirmado nada.
  if (evento.tipo === "sessao-aberta") return "ONLINE";

  switch (evento.tipo) {
    case "pedido":
      return "WAKE_REQUESTED";
    case "sem-ponte":
      return "NO_BRIDGE";
    case "sem-suporte":
      return "UNSUPPORTED";
    case "ponte-falhou":
      return "FAILED";
    case "ponte-emitiu":
      // Só avança a partir do pedido: um segundo "emitiu" de uma retentativa
      // não pode empurrar de volta quem já está esperando o dispositivo.
      return atual === "WAKE_REQUESTED" ? "WAKE_SENT" : atual;
    case "alvo-na-sinalizacao":
      return "AGENT_CONNECTING";
    case "tempo-esgotado":
      return "TIMED_OUT";
  }
}

/**
 * Quanto tempo esperar antes de declarar `TIMED_OUT`.
 *
 * Generoso de propósito. Um computador saindo de hibernação com disco rígido
 * mecânico e um POST demorado passa confortavelmente de um minuto, e desistir
 * cedo produz o pior resultado possível: a interface diz que falhou enquanto a
 * máquina está ligando na sala ao lado.
 */
export const ESPERA_ACORDAR_MS = 180_000;

/**
 * Intervalo mínimo entre pacotes de uma mesma tentativa.
 *
 * Retentativa existe porque um quadro de broadcast pode se perder, mas repetir
 * depressa não aumenta a chance de acordar — a máquina leva segundos só para
 * energizar. Serve para não transformar um botão em enxurrada de pacotes.
 */
export const INTERVALO_RETENTATIVA_MS = 15_000;

/** Teto de pacotes por pedido, contando o primeiro. */
export const MAX_PACOTES_POR_PEDIDO = 4;
