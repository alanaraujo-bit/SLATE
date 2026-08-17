/**
 * Espelho tipado dos tokens definidos em `tokens.css`.
 *
 * Os valores continuam no CSS — é lá que são consumidos. O que existe aqui são
 * os nomes, para que código TypeScript (um seletor de cor de controle, por
 * exemplo) não escreva string solta e erre em silêncio.
 */

export const ESPACO = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16] as const;
export type Espaco = (typeof ESPACO)[number];
export const espaco = (n: Espaco) => `var(--s-space-${n})`;

export const RAIOS = ["xs", "sm", "md", "lg", "xl", "full"] as const;
export type Raio = (typeof RAIOS)[number];
export const raio = (r: Raio) => `var(--s-radius-${r})`;

export const TAMANHOS_TEXTO = [
  "2xs",
  "xs",
  "sm",
  "md",
  "lg",
  "xl",
  "2xl",
  "3xl",
] as const;
export type TamanhoTexto = (typeof TAMANHOS_TEXTO)[number];

export const DURACOES = ["instant", "fast", "normal", "slow"] as const;
export type Duracao = (typeof DURACOES)[number];

/**
 * Cores que o usuário pode atribuir a um controle.
 *
 * A chave é o que fica gravado no banco; o valor é o token CSS. Guardar o hex
 * no banco impediria de ajustar a paleta depois sem migrar dados de todo mundo.
 */
export const CORES_CONTROLE = {
  red: "var(--s-control-red)",
  orange: "var(--s-control-orange)",
  amber: "var(--s-control-amber)",
  yellow: "var(--s-control-yellow)",
  lime: "var(--s-control-lime)",
  green: "var(--s-control-green)",
  teal: "var(--s-control-teal)",
  cyan: "var(--s-control-cyan)",
  blue: "var(--s-control-blue)",
  indigo: "var(--s-control-indigo)",
  violet: "var(--s-control-violet)",
  pink: "var(--s-control-pink)",
} as const;

export type CorControle = keyof typeof CORES_CONTROLE;
export const CORES_CONTROLE_LISTA = Object.keys(CORES_CONTROLE) as CorControle[];

/** Valores literais, para cálculo de contraste e para pré-visualização. */
export const HEX_CORES_CONTROLE: Record<CorControle, string> = {
  red: "#f2555a",
  orange: "#f97d3c",
  amber: "#f5a524",
  yellow: "#e8c547",
  lime: "#9dd549",
  green: "#3fc06a",
  teal: "#2dc3a6",
  cyan: "#26bad6",
  blue: "#3b8df5",
  indigo: "#6b6ef0",
  violet: "#9b6ef3",
  pink: "#ee5fa7",
};

/**
 * Estados que todo controle precisa saber representar (§10).
 *
 * Estão aqui, e não em cada componente, porque a lista precisa ser a mesma em
 * todos: um controle que esquece `unavailable` mente para o usuário quando o
 * Agente cai.
 */
export const ESTADOS_CONTROLE = [
  "idle",
  "hover",
  "pressed",
  "active",
  "loading",
  "disabled",
  "unavailable",
  "error",
] as const;

export type EstadoControle = (typeof ESTADOS_CONTROLE)[number];

/** Estados em que o controle não deve reagir ao toque. */
export const ESTADOS_INERTES: readonly EstadoControle[] = [
  "loading",
  "disabled",
  "unavailable",
];

export function aceitaInteracao(estado: EstadoControle): boolean {
  return !ESTADOS_INERTES.includes(estado);
}

// ---------------------------------------------------------------------------
// Contraste
// ---------------------------------------------------------------------------

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export function hexParaRgb(hex: string): RGB {
  const limpo = hex.replace("#", "").trim();
  const completo =
    limpo.length === 3
      ? limpo
          .split("")
          .map((c) => c + c)
          .join("")
      : limpo;

  if (!/^[0-9a-fA-F]{6}$/.test(completo)) {
    throw new Error(`Cor hexadecimal inválida: ${hex}`);
  }

  return {
    r: Number.parseInt(completo.slice(0, 2), 16),
    g: Number.parseInt(completo.slice(2, 4), 16),
    b: Number.parseInt(completo.slice(4, 6), 16),
  };
}

/** Luminância relativa conforme WCAG 2.1. */
export function luminancia({ r, g, b }: RGB): number {
  const canal = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

/** Razão de contraste WCAG entre duas cores, de 1 a 21. */
export function contraste(a: string, b: string): number {
  const la = luminancia(hexParaRgb(a));
  const lb = luminancia(hexParaRgb(b));
  const claro = Math.max(la, lb);
  const escuro = Math.min(la, lb);
  return (claro + 0.05) / (escuro + 0.05);
}

/** Limiares WCAG AA. Texto grande é ≥18.66px em negrito ou ≥24px normal. */
export const AA_TEXTO_NORMAL = 4.5;
export const AA_TEXTO_GRANDE = 3;
export const AA_COMPONENTE = 3;

export function passaAA(
  primeiroPlano: string,
  fundo: string,
  alvo: number = AA_TEXTO_NORMAL,
): boolean {
  return contraste(primeiroPlano, fundo) >= alvo;
}

/**
 * Escolhe entre texto escuro e claro para ficar por cima de uma cor.
 *
 * Existe porque a cor do controle é escolhida pelo usuário: a paleta é
 * conhecida, mas qual delas cada pessoa vai usar não é, e um rótulo ilegível
 * transforma a cor num problema em vez de um recurso.
 */
export function textoSobre(
  fundo: string,
  claro = "#ffffff",
  escuro = "#0d0f18",
): string {
  return contraste(escuro, fundo) >= contraste(claro, fundo) ? escuro : claro;
}

/** Valores semânticos do tema escuro, para verificação automatizada. */
export const TEMA_ESCURO = {
  bg: "#08090f",
  surface: "#0d0f18",
  surfaceRaised: "#131622",
  border: "#1f2231",
  borderStrong: "#2f3446",
  text: "#eef0f7",
  textMuted: "#a6adc0",
  textSubtle: "#868ea4",
  accent: "#6ee7f0",
  onAccent: "#04141a",
  success: "#4ade80",
  warning: "#fbbf24",
  danger: "#f87171",
  info: "#7dd3fc",
} as const;

/** Valores semânticos do tema claro, para verificação automatizada. */
export const TEMA_CLARO = {
  bg: "#f4f5f8",
  surface: "#ffffff",
  surfaceRaised: "#ffffff",
  border: "#e5e7ed",
  borderStrong: "#cfd2dc",
  text: "#131622",
  textMuted: "#4d5568",
  textSubtle: "#666e83",
  accent: "#0e7f92",
  onAccent: "#ffffff",
  success: "#16a34a",
  warning: "#d97706",
  danger: "#dc2626",
  info: "#0284c7",
} as const;
