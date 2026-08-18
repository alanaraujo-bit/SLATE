/**
 * A grade de controles do painel.
 *
 * Cada tecla é um identificador de ação e nada mais. O Agente tem a lista
 * fechada do outro lado (`apps/desktop/src-tauri/src/acoes.rs`) e recusa o que
 * não estiver nela — o celular nunca manda uma tecla, um comando ou um caminho.
 *
 * **Os dois lados precisam andar juntos.** Uma tecla aqui sem a ação
 * correspondente lá vira um botão que responde "ação não encontrada", que é
 * pior do que não ter o botão. O teste `toda_a_grade_de_midia_e_reconhecida`
 * em `acoes.rs` fixa a lista do lado do Rust; `controles.test.ts` fixa esta.
 */

import type { NomeMarca } from "@slate/design-system";
import { ACOES_ENERGIA, type CallEstado, type PerfilEnergia } from "@slate/protocol";

export interface Controle {
  actionId: string;
  rotulo: string;
  /** Nome do ícone no design system. */
  icone:
    | "Anterior"
    | "Play"
    | "Proximo"
    | "Volume"
    | "Mudo"
    | "Parar"
    | "Monitor"
    | "Escudo"
    | "Camada"
    | "Atualizar"
    | "Energia"
    | "Microfone"
    | "MicrofoneMudo";
  /**
   * Só aparece quando o Agente anunciou `action.media.completo`.
   *
   * A PWA se publica na hora e o Agente é um instalador: sem esta marca, um
   * Agente antigo receberia botões que ele não sabe executar.
   */
  exigeGradeCompleta: boolean;
  /** Ocupa duas colunas no modo em pé: é a tecla mais usada. */
  destaque?: boolean;
  /** Marca visual própria para serviços conhecidos; não é um ícone do sistema. */
  marca?: NomeMarca;
}

export const CONTROLES_MIDIA: readonly Controle[] = [
  {
    actionId: "midia.anterior",
    rotulo: "Anterior",
    icone: "Anterior",
    exigeGradeCompleta: true,
  },
  {
    actionId: "midia.reproduzir-pausar",
    rotulo: "Reproduzir / pausar",
    icone: "Play",
    exigeGradeCompleta: false,
    destaque: true,
  },
  {
    actionId: "midia.proxima",
    rotulo: "Próxima",
    icone: "Proximo",
    exigeGradeCompleta: true,
  },
];

export const CONTROLES_VOLUME: readonly Controle[] = [
  {
    actionId: "volume.diminuir",
    rotulo: "Menos volume",
    icone: "Volume",
    exigeGradeCompleta: true,
  },
  {
    actionId: "volume.mudo",
    rotulo: "Mudo",
    icone: "Mudo",
    exigeGradeCompleta: true,
  },
  {
    actionId: "volume.aumentar",
    rotulo: "Mais volume",
    icone: "Volume",
    exigeGradeCompleta: true,
  },
  {
    actionId: "midia.parar",
    rotulo: "Parar",
    icone: "Parar",
    exigeGradeCompleta: true,
  },
];

/**
 * Atalhos de abertura.
 *
 * Só aparecem quando o Agente anuncia `action.atalhos`, o que ele faz por par e
 * apenas para quem recebeu a permissão marcada na interface do computador. O
 * pareamento **não** concede isso: abrir programa é autoridade diferente de
 * mexer no que já está tocando, e quem concede precisa estar na frente da
 * máquina (ADR-0004).
 *
 * O endereço de cada atalho é constante de compilação no Agente. Daqui vai só o
 * identificador — nunca uma URL.
 *
 * `exigeGradeCompleta` é `false` em todos porque o grupo inteiro é liberado de
 * uma vez por `action.atalhos`; marcar `true` sugeriria um filtro por tecla que
 * não existe neste caminho.
 */
export const CONTROLES_ATALHOS: readonly Controle[] = [
  {
    actionId: "atalho.youtube",
    rotulo: "YouTube",
    icone: "Monitor",
    marca: "youtube",
    exigeGradeCompleta: false,
  },
  {
    actionId: "atalho.twitch",
    rotulo: "Twitch",
    icone: "Monitor",
    marca: "twitch",
    exigeGradeCompleta: false,
  },
  {
    actionId: "atalho.netflix",
    rotulo: "Netflix",
    icone: "Monitor",
    marca: "netflix",
    exigeGradeCompleta: false,
  },
  {
    actionId: "atalho.prime",
    rotulo: "Prime Video",
    icone: "Monitor",
    marca: "prime",
    exigeGradeCompleta: false,
  },
  {
    actionId: "atalho.disney",
    rotulo: "Disney+",
    icone: "Monitor",
    marca: "disney",
    exigeGradeCompleta: false,
  },
  {
    actionId: "atalho.spotify",
    rotulo: "Spotify",
    icone: "Monitor",
    marca: "spotify",
    exigeGradeCompleta: false,
  },
];

/**
 * Os controles de energia (ADR-0006).
 *
 * Diferente de todos os outros grupos: quais teclas aparecem **não** é decidido
 * por uma capacidade única, e sim pelo perfil daquela máquina, tecla por tecla.
 * Duas máquinas com o mesmo Agente mostram grades diferentes — uma hiberna, a
 * outra não —, e é isso que o mandato pede quando diz para nunca fingir
 * suporte.
 *
 * `exigeGradeCompleta` é `false` em todos porque o filtro aqui é outro: é
 * `energiaVisivel`, logo abaixo.
 */
export interface ControleEnergia extends Controle {
  /** A chave do perfil que decide se esta tecla existe naquela máquina. */
  capacidade: keyof Pick<
    PerfilEnergia,
    "bloquear" | "suspender" | "hibernar" | "reiniciar" | "desligar" | "cancelarDesligamento"
  >;
  /** Pede confirmação deliberada em vez de executar ao toque. */
  destrutiva: boolean;
}

export const CONTROLES_ENERGIA: readonly ControleEnergia[] = [
  {
    actionId: ACOES_ENERGIA.bloquear,
    rotulo: "Bloquear",
    icone: "Escudo",
    capacidade: "bloquear",
    destrutiva: false,
    exigeGradeCompleta: false,
  },
  {
    actionId: ACOES_ENERGIA.suspender,
    rotulo: "Suspender",
    icone: "Monitor",
    capacidade: "suspender",
    // Suspender não fecha nada e volta com um toque no teclado. Pedir
    // cerimônia aqui treinaria a pessoa a confirmar sem ler, e aí a
    // confirmação do desligar também deixa de proteger.
    destrutiva: false,
    exigeGradeCompleta: false,
  },
  {
    actionId: ACOES_ENERGIA.hibernar,
    rotulo: "Hibernar",
    icone: "Camada",
    capacidade: "hibernar",
    destrutiva: true,
    exigeGradeCompleta: false,
  },
  {
    actionId: ACOES_ENERGIA.reiniciar,
    rotulo: "Reiniciar",
    icone: "Atualizar",
    capacidade: "reiniciar",
    destrutiva: true,
    exigeGradeCompleta: false,
  },
  {
    actionId: ACOES_ENERGIA.desligar,
    rotulo: "Desligar",
    icone: "Energia",
    capacidade: "desligar",
    destrutiva: true,
    exigeGradeCompleta: false,
  },
];

/**
 * As teclas de energia que aquela máquina de fato sabe executar.
 *
 * Sem perfil não há grade nenhuma — e isso é o certo, não uma falta. Um Agente
 * que não anunciou `energia.controle` não recebeu a permissão, ou é antigo
 * demais para conhecer energia; nos dois casos, desenhar botões produziria
 * teclas que respondem "escopo negado" ou "ação não encontrada".
 *
 * `Desconhecido` também não mostra a tecla. É a mesma disciplina do Agente:
 * desconhecido não é permissão.
 */
export function energiaVisivel(
  perfil: PerfilEnergia | undefined,
): readonly ControleEnergia[] {
  if (!perfil) return [];
  return CONTROLES_ENERGIA.filter((c) => perfil[c.capacidade] === "sim");
}

/**
 * O texto de Pronto para Retorno para aquela máquina.
 *
 * Devolve `undefined` quando não existe — e a tela mostra a ausência com o
 * motivo, em vez de esconder. É a diferença entre explicar uma limitação e
 * fingir que ela não existe.
 */
export function textoProntoParaRetorno(
  perfil: PerfilEnergia | undefined,
): string | undefined {
  if (!perfil) return undefined;
  switch (perfil.prontoParaRetorno) {
    case "desligado":
      return "Desliga por completo e volta pelo SLATE.";
    case "hibernado":
      return "Hiberna com o mínimo de consumo e volta pelo SLATE.";
    case "nenhum":
      return undefined;
  }
}

/**
 * Por que não há Pronto para Retorno naquela máquina, em linguagem de produto.
 *
 * O usuário comum não precisa saber o que são S3, S4, ACPI ou pacote mágico —
 * precisa saber o que fazer. Cada motivo tem um texto próprio porque a ação é
 * diferente em cada um; um "não foi possível" genérico não ajuda ninguém.
 */
export function explicarSemRetorno(perfil: PerfilEnergia | undefined): string {
  const impedimentos = perfil?.impedimentos ?? [];
  if (impedimentos.includes("adaptador-nao-suporta")) {
    return "A rede deste computador não consegue ligá-lo de volta.";
  }
  if (impedimentos.includes("adaptador-sem-permissao")) {
    return "A placa de rede deste computador não está autorizada a ligá-lo. Dá para mudar isso na janela do SLATE nele.";
  }
  if (impedimentos.includes("hibernacao-desligada")) {
    return "A hibernação está desligada neste computador. Ligando ela, o SLATE consegue trazê-lo de volta.";
  }
  if (impedimentos.includes("firmware-precisa-de-ajuste")) {
    return "Falta um ajuste na configuração de inicialização deste computador para ele poder ser ligado à distância.";
  }
  if (impedimentos.includes("nao-testado")) {
    return "Ainda não foi testado se este computador consegue voltar depois de desligado.";
  }
  return "Este computador não consegue voltar sozinho depois de desligar.";
}

/**
 * O identificador de ação de um atalho de programa.
 *
 * O celular manda `programa.<id>` e nada mais. O caminho do executável fica no
 * computador, e é lá que o identificador vira alvo — a lista em disco é a
 * única tradução possível (ADR-0004). Daqui nunca sai um caminho.
 */
export function acaoDoPrograma(id: string): string {
  return `programa.${id}`;
}

/** As teclas visíveis, dado o que o Agente do outro lado sabe fazer. */
export function visiveis(
  lista: readonly Controle[],
  gradeCompleta: boolean,
): readonly Controle[] {
  return lista.filter((c) => gradeCompleta || !c.exigeGradeCompleta);
}

/**
 * O mudo do CALL.
 *
 * **Uma tecla só na tela, dois identificadores no canal.** Qual deles sai
 * depende do estado que chegou em `call.estado` — é o que permite dizer "fique
 * mudo" em vez de "alterne", sem a lista de ações do Agente deixar de ser
 * fechada. Alternar por um canal que pode repetir uma mensagem deixaria a tecla
 * dizendo o contrário do que está acontecendo no computador.
 */
export function controleDoCall(call: CallEstado | undefined): Controle | undefined {
  if (!call?.disponivel || !call.emChamada) return undefined;
  return call.mudo
    ? {
        actionId: "call.falar",
        rotulo: "Voltar a falar",
        icone: "MicrofoneMudo",
        exigeGradeCompleta: false,
      }
    : {
        actionId: "call.mudo",
        rotulo: "Mudo no CALL",
        icone: "Microfone",
        exigeGradeCompleta: false,
      };
}

/**
 * Por que a tecla do CALL não está ali, em linguagem de produto.
 *
 * Devolve `undefined` quando não há nada a explicar — ou porque a tecla está na
 * tela, ou porque aquele computador nem sabe o que é o CALL e prometer algo
 * seria pior do que o silêncio.
 *
 * As duas ausências têm causas diferentes e ações diferentes: uma se resolve
 * abrindo o CALL, a outra entrando num canal de voz. Um "indisponível" genérico
 * deixaria a pessoa sem saber qual das duas é.
 */
export function explicarSemCall(call: CallEstado | undefined): string | undefined {
  if (!call) return undefined;
  if (!call.disponivel) return "Abra o CALL nesse computador para o mudo aparecer aqui.";
  if (!call.emChamada) return "Entre num canal de voz do CALL para o mudo aparecer aqui.";
  return undefined;
}
