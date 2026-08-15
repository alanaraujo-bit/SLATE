import type { SVGProps } from "react";

/**
 * Iconografia do SLATE.
 *
 * Um conjunto único, desenhado sobre a mesma grade e com a mesma espessura de
 * traço. Isso não é preciosismo: ícones de origens diferentes têm pesos
 * visuais diferentes, e num control surface — onde o ícone frequentemente é a
 * única coisa que o botão mostra — a incoerência vira dificuldade de leitura.
 *
 * Regras do conjunto:
 *
 *  - grade de 24, traço de 1,5, pontas e junções arredondadas;
 *  - traço em vez de preenchimento, para que a mesma forma funcione sobre
 *    qualquer cor de controle;
 *  - `currentColor`, para herdar a cor do contexto sem precisar de variante;
 *  - escondidos de leitores de tela por padrão, porque um ícone quase sempre
 *    acompanha texto — quando não acompanha, quem usa passa `titulo`.
 */

export interface IconeProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  /** Aresta do ícone. Aceita qualquer unidade CSS. */
  tamanho?: number | string;
  /**
   * Descrição para leitor de tela.
   *
   * Ausente, o ícone é tratado como decorativo. Presente, ele vira uma imagem
   * com nome acessível.
   */
  titulo?: string;
}

const BASE: SVGProps<SVGSVGElement> = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

function criarIcone(nome: string, caminho: string) {
  const Componente = ({ tamanho = 20, titulo, ...resto }: IconeProps) => (
    <svg
      {...BASE}
      width={tamanho}
      height={tamanho}
      role={titulo ? "img" : undefined}
      aria-hidden={titulo ? undefined : true}
      aria-label={titulo}
      {...resto}
    >
      <path d={caminho} />
    </svg>
  );
  Componente.displayName = `Icone${nome}`;
  return Componente;
}

/**
 * Definições em um único lugar, para que a auditoria do conjunto seja possível
 * — os testes percorrem este mapa para verificar coerência.
 */
export const CAMINHOS_ICONES = {
  // Mídia
  Play: "M8 5.5v13l10.5-6.5z",
  Pausar: "M9.5 5v14M14.5 5v14",
  Anterior: "M6 6v12M19 6.5v11L10 12z",
  Proximo: "M18 6v12M5 6.5v11L14 12z",
  Parar: "M6.5 6.5h11v11h-11z",

  // Áudio
  Volume: "M11 5 6.5 9H3v6h3.5L11 19zM15.5 9.5a3.5 3.5 0 0 1 0 5",
  Mudo: "M11 5 6.5 9H3v6h3.5L11 19zM16 10l4 4M20 10l-4 4",
  Microfone: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3",
  MicrofoneMudo: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3M4 4l16 16",

  // Transmissão
  Gravar: "M12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12z",
  Monitor: "M3 5h18v11H3zM8 20h8M12 16v4",
  Camada: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5",

  // Navegação
  Voltar: "M15 6l-6 6 6 6",
  Avancar: "M9 6l6 6-6 6",
  Pasta: "M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  Grade: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",

  // Sistema
  Energia: "M12 3v9M7.5 6.5a7.5 7.5 0 1 0 9 0",
  Processador: "M7 7h10v10H7zM9 3v4M15 3v4M9 17v4M15 17v4M3 9h4M3 15h4M17 9h4M17 15h4",
  Configuracoes:
    "M12 9.25a2.75 2.75 0 1 0 0 5.5 2.75 2.75 0 0 0 0-5.5zM19.4 12c0-.4-.04-.8-.1-1.2l2-1.5-2-3.4-2.3 1c-.6-.5-1.3-.9-2-1.2l-.3-2.4h-4l-.3 2.4c-.7.3-1.4.7-2 1.2l-2.3-1-2 3.4 2 1.5c-.06.4-.1.8-.1 1.2s.04.8.1 1.2l-2 1.5 2 3.4 2.3-1c.6.5 1.3.9 2 1.2l.3 2.4h4l.3-2.4c.7-.3 1.4-.7 2-1.2l2.3 1 2-3.4-2-1.5c.06-.4.1-.8.1-1.2z",

  // Desenvolvimento
  Terminal: "M5 6l5 6-5 6M13 18h6",
  Ramo: "M7 5.5a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5zM7 15a1.75 1.75 0 1 0 0 3.5A1.75 1.75 0 0 0 7 15zM17 5.5a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5zM7 9v6M17 9v1.5a3.5 3.5 0 0 1-3.5 3.5H7",
  Codigo: "M9 7l-5 5 5 5M15 7l5 5-5 5",

  // Estado
  Verificado: "M5 12.5l4.5 4.5L19 7.5",
  Fechar: "M6 6l12 12M18 6L6 18",
  Alerta: "M12 4L2.5 20h19zM12 10v4.5M12 17.4v.1",
  Mais: "M12 5v14M5 12h14",
  Atualizar: "M20 12a8 8 0 1 1-2.6-5.9M20 4v4h-4",
  Ligacao: "M9.5 14.5l5-5M8 12H6.5a3.5 3.5 0 1 1 0-7H10M14 5h3.5a3.5 3.5 0 0 1 0 7H16",
} as const;

export type NomeIcone = keyof typeof CAMINHOS_ICONES;
export const NOMES_ICONES = Object.keys(CAMINHOS_ICONES) as NomeIcone[];

export const IconePlay = criarIcone("Play", CAMINHOS_ICONES.Play);
export const IconePausar = criarIcone("Pausar", CAMINHOS_ICONES.Pausar);
export const IconeAnterior = criarIcone("Anterior", CAMINHOS_ICONES.Anterior);
export const IconeProximo = criarIcone("Proximo", CAMINHOS_ICONES.Proximo);
export const IconeParar = criarIcone("Parar", CAMINHOS_ICONES.Parar);
export const IconeVolume = criarIcone("Volume", CAMINHOS_ICONES.Volume);
export const IconeMudo = criarIcone("Mudo", CAMINHOS_ICONES.Mudo);
export const IconeMicrofone = criarIcone("Microfone", CAMINHOS_ICONES.Microfone);
export const IconeMicrofoneMudo = criarIcone(
  "MicrofoneMudo",
  CAMINHOS_ICONES.MicrofoneMudo,
);
export const IconeGravar = criarIcone("Gravar", CAMINHOS_ICONES.Gravar);
export const IconeMonitor = criarIcone("Monitor", CAMINHOS_ICONES.Monitor);
export const IconeCamada = criarIcone("Camada", CAMINHOS_ICONES.Camada);
export const IconeVoltar = criarIcone("Voltar", CAMINHOS_ICONES.Voltar);
export const IconeAvancar = criarIcone("Avancar", CAMINHOS_ICONES.Avancar);
export const IconePasta = criarIcone("Pasta", CAMINHOS_ICONES.Pasta);
export const IconeGrade = criarIcone("Grade", CAMINHOS_ICONES.Grade);
export const IconeEnergia = criarIcone("Energia", CAMINHOS_ICONES.Energia);
export const IconeProcessador = criarIcone("Processador", CAMINHOS_ICONES.Processador);
export const IconeConfiguracoes = criarIcone(
  "Configuracoes",
  CAMINHOS_ICONES.Configuracoes,
);
export const IconeTerminal = criarIcone("Terminal", CAMINHOS_ICONES.Terminal);
export const IconeRamo = criarIcone("Ramo", CAMINHOS_ICONES.Ramo);
export const IconeCodigo = criarIcone("Codigo", CAMINHOS_ICONES.Codigo);
export const IconeVerificado = criarIcone("Verificado", CAMINHOS_ICONES.Verificado);
export const IconeFechar = criarIcone("Fechar", CAMINHOS_ICONES.Fechar);
export const IconeAlerta = criarIcone("Alerta", CAMINHOS_ICONES.Alerta);
export const IconeMais = criarIcone("Mais", CAMINHOS_ICONES.Mais);
export const IconeAtualizar = criarIcone("Atualizar", CAMINHOS_ICONES.Atualizar);
export const IconeLigacao = criarIcone("Ligacao", CAMINHOS_ICONES.Ligacao);

/** Todos os ícones por nome, para renderizar a partir de configuração. */
export const ICONES: Record<NomeIcone, ReturnType<typeof criarIcone>> = {
  Play: IconePlay,
  Pausar: IconePausar,
  Anterior: IconeAnterior,
  Proximo: IconeProximo,
  Parar: IconeParar,
  Volume: IconeVolume,
  Mudo: IconeMudo,
  Microfone: IconeMicrofone,
  MicrofoneMudo: IconeMicrofoneMudo,
  Gravar: IconeGravar,
  Monitor: IconeMonitor,
  Camada: IconeCamada,
  Voltar: IconeVoltar,
  Avancar: IconeAvancar,
  Pasta: IconePasta,
  Grade: IconeGrade,
  Energia: IconeEnergia,
  Processador: IconeProcessador,
  Configuracoes: IconeConfiguracoes,
  Terminal: IconeTerminal,
  Ramo: IconeRamo,
  Codigo: IconeCodigo,
  Verificado: IconeVerificado,
  Fechar: IconeFechar,
  Alerta: IconeAlerta,
  Mais: IconeMais,
  Atualizar: IconeAtualizar,
  Ligacao: IconeLigacao,
};

/**
 * Renderiza um ícone a partir do nome.
 *
 * Necessário porque a escolha de ícone de um controle vem do banco, como
 * texto, e não como referência a um componente.
 */
export function Icone({ nome, ...resto }: IconeProps & { nome: NomeIcone }) {
  const Componente = ICONES[nome];
  return <Componente {...resto} />;
}
