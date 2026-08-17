import type { SVGProps } from "react";

/**
 * Marcas dos serviços que o painel abre.
 *
 * **São desenho nosso, e isso é decisão, não limitação.** Um produto vendido
 * por assinatura não embute o logotipo registrado de outra empresa; o que
 * embute é um símbolo próprio que diz do que se trata. Cada marca aqui usa a
 * cor pela qual o serviço é reconhecido e a forma da categoria — vídeo, chat
 * ao vivo, áudio — sem reproduzir a arte de ninguém.
 *
 * Elas são preenchidas, e os ícones de `icones.tsx` são de traço. A diferença
 * é proposital: numa tecla, o traço é comando e o preenchimento é destino.
 * Quem olha o painel separa "faz alguma coisa" de "abre alguma coisa" antes de
 * ler o rótulo.
 *
 * A cor não mora aqui — mora no CSS, em `.marca-servico--*`, via
 * `currentColor`. É o que permite a mesma marca funcionar apagada num catálogo
 * e acesa numa tecla sem existir uma segunda cópia.
 */

export const MARCAS = [
  "youtube",
  "twitch",
  "netflix",
  "prime",
  "disney",
  "spotify",
] as const;

export type NomeMarca = (typeof MARCAS)[number];

export interface MarcaProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  tamanho?: number | string;
  /** Descrição para leitor de tela. Ausente, a marca é decorativa. */
  titulo?: string;
}

/**
 * Caminhos por marca.
 *
 * `evenodd` em todas: os vazios — o triângulo do play, a haste do "D", as
 * barras do chat — são furos na mesma forma, e não uma segunda forma pintada
 * da cor do fundo. Furo de verdade é o que faz a marca continuar legível sobre
 * a tecla colorida, onde "a cor do fundo" não é uma cor só.
 */
export const CAMINHOS_MARCAS: Record<NomeMarca, string> = {
  /* Tela com o play vazado: a forma da categoria vídeo. */
  youtube:
    "M5 4.5h14A3.5 3.5 0 0 1 22.5 8v8a3.5 3.5 0 0 1-3.5 3.5H5A3.5 3.5 0 0 1 1.5 16V8A3.5 3.5 0 0 1 5 4.5zm5 4.2v6.6l5.8-3.3z",

  /* Balão de conversa com duas barras: transmissão com chat ao lado. */
  twitch:
    "M4.5 3.5h15A2.5 2.5 0 0 1 22 6v9a2.5 2.5 0 0 1-2.5 2.5h-4.3L10 22.2V17.5H4.5A2.5 2.5 0 0 1 2 15V6a2.5 2.5 0 0 1 2.5-2.5zM9 7.2v6.2h2V7.2zm4.8 0v6.2h2V7.2z",

  /* Monograma N, em bloco cheio. */
  netflix: "M4.5 2.5h4.4l6.2 11.4V2.5h4.4v19h-4.4L8.9 10.1v11.4H4.5z",

  /*
   * Play em disco, sobre um arco.
   *
   * O disco não é enfeite: na primeira versão esta marca era uma tela
   * retangular com o play vazado, e a 20px ela era o YouTube pintado de outra
   * cor. Numa grade de teclas isso é defeito — quem procura o serviço acha a
   * cor antes da forma, e cor sozinha não sobrevive a um painel monocromático
   * nem a quem não distingue vermelho de ciano. Retângulo e círculo se separam
   * na silhueta, que é o que o olho lê primeiro.
   */
  prime:
    "M12 2.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15zm-2.4 3.9v7.2l6-3.6zM2.6 19.4c5.8 3 12.8 3 18.6 0-5.8 2-12.8 2-18.6 0z",

  /* Monograma D com o mais que o serviço carrega no nome. */
  disney:
    "M2.5 3.5h4.8a9 9 0 0 1 0 18H2.5zm4.3 4v10h.5a5 5 0 0 0 0-10zM17.2 6.8h2.4v3.5h3.4v2.4h-3.4v3.5h-2.4v-3.5h-3.4v-2.4h3.4z",

  /* Três arcos em leque: som saindo, sem caixa em volta. */
  spotify:
    "M3.4 7.6c5.4-3.3 11.8-3.3 17.2 0l-1.5 2.5c-4.5-2.7-9.7-2.7-14.2 0zM5.6 12.8c4-2.2 8.8-2.2 12.8 0l-1.4 2.4c-3.2-1.7-6.8-1.7-10 0zM7.9 18c2.6-1.4 5.6-1.4 8.2 0l-1.4 2.3c-1.8-.9-3.6-.9-5.4 0z",
};

/**
 * Uma marca de serviço.
 *
 * Decorativa por padrão: na tecla ela vem acompanhada do nome escrito, e
 * anunciar "YouTube YouTube" a quem usa leitor de tela é ruído, não acesso.
 */
export function Marca({ nome, tamanho = 20, titulo, ...resto }: MarcaProps & { nome: NomeMarca }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={tamanho}
      height={tamanho}
      fill="currentColor"
      fillRule="evenodd"
      clipRule="evenodd"
      role={titulo ? "img" : undefined}
      aria-hidden={titulo ? undefined : true}
      aria-label={titulo}
      {...resto}
    >
      <path d={CAMINHOS_MARCAS[nome]} />
    </svg>
  );
}
