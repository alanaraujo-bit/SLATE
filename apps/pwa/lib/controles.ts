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

export interface Controle {
  actionId: string;
  rotulo: string;
  /** Nome do ícone no design system. */
  icone: "Anterior" | "Play" | "Proximo" | "Volume" | "Mudo" | "Parar";
  /**
   * Só aparece quando o Agente anunciou `action.media.completo`.
   *
   * A PWA se publica na hora e o Agente é um instalador: sem esta marca, um
   * Agente antigo receberia botões que ele não sabe executar.
   */
  exigeGradeCompleta: boolean;
  /** Ocupa duas colunas no modo em pé: é a tecla mais usada. */
  destaque?: boolean;
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

/** As teclas visíveis, dado o que o Agente do outro lado sabe fazer. */
export function visiveis(
  lista: readonly Controle[],
  gradeCompleta: boolean,
): readonly Controle[] {
  return lista.filter((c) => gradeCompleta || !c.exigeGradeCompleta);
}
