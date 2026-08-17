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
    | "Monitor";
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
