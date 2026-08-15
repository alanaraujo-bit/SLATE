import { ESTADOS_CONEXAO, type EstadoConexao } from "@slate/protocol";

/**
 * O que cada estado de conexão significa para quem está olhando a tela.
 *
 * O mandato §37 pede que a interface explique o estado "sem parecer quebrada".
 * A diferença entre as duas coisas é concreta: um controle que não responde e
 * não diz nada parece defeito do produto; o mesmo controle dizendo "o
 * computador está desligado" é informação útil.
 *
 * Cada estado precisa responder três perguntas: o que houve, se é problema do
 * usuário, e o que fazer agora. Estado sem resposta para as três é estado que
 * vai gerar suporte.
 */

export type TomEstado = "neutro" | "positivo" | "atencao" | "erro";

export interface DescricaoEstado {
  titulo: string;
  explicacao: string;
  /** Ação que resolve, quando existe uma. */
  acao?: string;
  tom: TomEstado;
  /** Se os controles devem aceitar toque. */
  operavel: boolean;
  /** Se a aplicação está tentando resolver sozinha. */
  tentandoSozinho: boolean;
}

export const DESCRICOES: Record<EstadoConexao, DescricaoEstado> = {
  CONNECTED: {
    titulo: "Conectado",
    explicacao: "Seu computador está respondendo.",
    tom: "positivo",
    operavel: true,
    tentandoSozinho: false,
  },

  CONNECTING: {
    titulo: "Conectando",
    explicacao: "Procurando seu computador.",
    tom: "neutro",
    operavel: false,
    tentandoSozinho: true,
  },

  RECONNECTING: {
    titulo: "Reconectando",
    explicacao: "A conexão caiu e está sendo refeita.",
    tom: "atencao",
    operavel: false,
    tentandoSozinho: true,
  },

  OFFLINE: {
    titulo: "Sem internet",
    explicacao: "Este aparelho está sem rede.",
    acao: "Verifique o Wi-Fi ou os dados móveis.",
    tom: "erro",
    operavel: false,
    // A rede volta sozinha com frequência, então a aplicação continua tentando
    // em vez de exigir que a pessoa recarregue.
    tentandoSozinho: true,
  },

  AGENT_UNAVAILABLE: {
    titulo: "Computador indisponível",
    explicacao:
      "Este aparelho está conectado, mas o SLATE não está respondendo no computador.",
    acao: "Confira se o computador está ligado e se o SLATE está aberto nele.",
    tom: "atencao",
    operavel: false,
    tentandoSozinho: true,
  },

  AUTH_REQUIRED: {
    titulo: "Entrar novamente",
    explicacao: "Sua sessão expirou.",
    acao: "Entre na sua conta para continuar.",
    tom: "atencao",
    operavel: false,
    // Só a pessoa pode resolver: insistir sozinho aqui é ficar tentando algo
    // que nunca vai dar certo.
    tentandoSozinho: false,
  },

  PAIRING_REQUIRED: {
    titulo: "Parear com o computador",
    explicacao: "Este aparelho ainda não está autorizado a controlar um computador.",
    acao: "Abra o SLATE no computador e faça o pareamento.",
    tom: "neutro",
    operavel: false,
    tentandoSozinho: false,
  },

  VERSION_MISMATCH: {
    titulo: "Versões incompatíveis",
    explicacao:
      "O SLATE do computador e o deste aparelho estão em versões que não conversam.",
    acao: "Atualize o SLATE no computador.",
    tom: "atencao",
    operavel: false,
    tentandoSozinho: false,
  },
};

export function descrever(estado: EstadoConexao): DescricaoEstado {
  return DESCRICOES[estado];
}

/**
 * Se os controles devem aceitar toque.
 *
 * Deixar um controle acionável sem conexão faria a pessoa tocar, nada
 * acontecer, e ela tocar de novo — e quando a conexão voltasse, receberia os
 * comandos acumulados de uma vez.
 */
export function podeOperar(estado: EstadoConexao): boolean {
  return DESCRICOES[estado].operavel;
}

/** Estados em que faz sentido mostrar uma indicação de atividade. */
export function estaTentando(estado: EstadoConexao): boolean {
  return DESCRICOES[estado].tentandoSozinho;
}

/**
 * Estados que a pessoa precisa resolver, e que por isso merecem interromper a
 * tela em vez de aparecer só como faixa discreta.
 */
export function exigeAtencao(estado: EstadoConexao): boolean {
  const descricao = DESCRICOES[estado];
  return !descricao.operavel && !descricao.tentandoSozinho;
}

export { ESTADOS_CONEXAO };
export type { EstadoConexao };
