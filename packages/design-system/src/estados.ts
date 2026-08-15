import type { EstadoControle } from "./tokens";

/**
 * Como um estado de controle se traduz em comportamento e em anúncio.
 *
 * Isto está separado dos componentes porque é a parte que precisa estar certa:
 * um controle que parece acionável e não faz nada, ou que não anuncia que está
 * indisponível, mente para quem está usando. E o SLATE é usado com a atenção
 * em outro lugar — no jogo, no código —, então o feedback precisa ser correto
 * sem exigir que a pessoa olhe com cuidado.
 */

export interface ComportamentoEstado {
  /** Se um toque deve produzir alguma ação. */
  acionavel: boolean;
  /** Vai para `aria-disabled`. */
  ariaDisabled: boolean;
  /** Vai para `aria-busy`. */
  ariaBusy: boolean;
  /**
   * Se o elemento continua alcançável pelo teclado.
   *
   * Um controle indisponível permanece focalizável de propósito: quem navega
   * por teclado ou leitor de tela precisa conseguir encontrá-lo para ouvir
   * *por que* está indisponível. Removê-lo da ordem de tabulação esconde a
   * informação em vez de comunicá-la.
   */
  focalizavel: boolean;
  /** Texto complementar lido por tecnologia assistiva. */
  anuncio?: string;
}

export const COMPORTAMENTO: Record<EstadoControle, ComportamentoEstado> = {
  idle: { acionavel: true, ariaDisabled: false, ariaBusy: false, focalizavel: true },
  hover: { acionavel: true, ariaDisabled: false, ariaBusy: false, focalizavel: true },
  pressed: { acionavel: true, ariaDisabled: false, ariaBusy: false, focalizavel: true },
  active: {
    acionavel: true,
    ariaDisabled: false,
    ariaBusy: false,
    focalizavel: true,
    anuncio: "ativo",
  },
  loading: {
    acionavel: false,
    ariaDisabled: false,
    ariaBusy: true,
    focalizavel: true,
    anuncio: "executando",
  },
  disabled: {
    acionavel: false,
    ariaDisabled: true,
    ariaBusy: false,
    focalizavel: false,
    anuncio: "desativado",
  },
  unavailable: {
    acionavel: false,
    ariaDisabled: true,
    ariaBusy: false,
    focalizavel: true,
    anuncio: "indisponível — sem conexão com o computador",
  },
  error: {
    acionavel: true,
    ariaDisabled: false,
    ariaBusy: false,
    focalizavel: true,
    anuncio: "a última execução falhou",
  },
};

export function comportamentoDe(estado: EstadoControle): ComportamentoEstado {
  return COMPORTAMENTO[estado];
}

/**
 * Estado resultante de uma execução em andamento.
 *
 * Um controle não decide sozinho se está carregando: isso vem do Agente. Esta
 * função concentra a precedência para que ela não seja reinventada, de formas
 * diferentes, em cada tipo de controle.
 */
export function resolverEstado(entrada: {
  conectado: boolean;
  desativado?: boolean;
  executando?: boolean;
  falhou?: boolean;
  ativo?: boolean;
}): EstadoControle {
  // A ordem é a precedência, e ela importa. Sem conexão vem primeiro porque
  // nenhum outro estado é verdade quando o computador está fora de alcance:
  // mostrar "ativo" ou "executando" nesse caso seria informação inventada.
  if (!entrada.conectado) return "unavailable";
  if (entrada.desativado) return "disabled";
  if (entrada.executando) return "loading";
  if (entrada.falhou) return "error";
  if (entrada.ativo) return "active";
  return "idle";
}
