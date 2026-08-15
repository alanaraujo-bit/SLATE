import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes } from "react";
import type { CorControle, EstadoControle } from "./tokens";
import { comportamentoDe } from "./estados";

/**
 * Primitivas do SLATE.
 *
 * Deliberadamente poucas. Os componentes ricos do produto — Botão de deck,
 * Slider, Dial, Medidor — são construídos sobre estas, e não ao lado delas.
 * Cada primitiva aqui existe porque resolve um problema que reapareceria em
 * todos os controles: comportamento por estado, alvo de toque, anúncio para
 * leitor de tela.
 */

export type Tom = "neutro" | "acento" | "sucesso" | "aviso" | "perigo";
export type Tamanho = "sm" | "md" | "lg";

// ---------------------------------------------------------------------------
// Botao
// ---------------------------------------------------------------------------

export interface BotaoProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "disabled"> {
  estado?: EstadoControle;
  tom?: Tom;
  tamanho?: Tamanho;
  /** Cor escolhida pelo usuário. Vence o `tom` quando presente. */
  cor?: CorControle;
  /** Rótulo para leitor de tela quando o conteúdo visível é só um ícone. */
  rotuloAcessivel?: string;
  /** Para controles de alternância. */
  alternado?: boolean;
}

/**
 * O botão base de todo control surface.
 *
 * Duas decisões que valem explicar:
 *
 * O bloqueio de acionamento acontece **aqui**, e não via atributo `disabled`.
 * Um `<button disabled>` some da ordem de tabulação e para de ser anunciado,
 * o que faz um controle temporariamente indisponível desaparecer para quem
 * usa teclado ou leitor de tela — justamente quando essa pessoa mais precisa
 * saber por que ele não responde. Com `aria-disabled` o controle continua
 * encontrável e explica o próprio estado.
 *
 * E o estado nunca é inferido do próprio componente: quem manda é o Agente. Um
 * botão que decide sozinho que está "carregando" mente assim que uma mensagem
 * se perde.
 */
export const Botao = forwardRef<HTMLButtonElement, BotaoProps>(function Botao(
  {
    estado = "idle",
    tom = "neutro",
    tamanho = "md",
    cor,
    rotuloAcessivel,
    alternado,
    onClick,
    children,
    className,
    style,
    ...resto
  },
  ref,
) {
  const comportamento = comportamentoDe(estado);

  return (
    <button
      ref={ref}
      type="button"
      className={["s-botao", className].filter(Boolean).join(" ")}
      data-estado={estado}
      data-tom={tom}
      data-tamanho={tamanho}
      data-cor={cor}
      aria-disabled={comportamento.ariaDisabled || undefined}
      aria-busy={comportamento.ariaBusy || undefined}
      aria-pressed={alternado}
      aria-label={rotuloAcessivel}
      tabIndex={comportamento.focalizavel ? 0 : -1}
      style={cor ? { ...style, ["--cor-controle" as string]: `var(--s-control-${cor})` } : style}
      onClick={(evento) => {
        if (!comportamento.acionavel) {
          // Impede que um clique em estado inerte suba e seja tratado por um
          // contêiner acima, que não conhece o estado deste controle.
          evento.preventDefault();
          evento.stopPropagation();
          return;
        }
        onClick?.(evento);
      }}
      {...resto}
    >
      <span className="s-botao__conteudo">{children}</span>
      {comportamento.anuncio && (
        <span className="s-visualmente-oculto">{comportamento.anuncio}</span>
      )}
    </button>
  );
});

// ---------------------------------------------------------------------------
// Superficie
// ---------------------------------------------------------------------------

export interface SuperficieProps extends HTMLAttributes<HTMLDivElement> {
  nivel?: "base" | "elevada" | "sobreposta";
  /** Aplica preenchimento interno padrão. */
  preenchida?: boolean;
}

export const Superficie = forwardRef<HTMLDivElement, SuperficieProps>(
  function Superficie({ nivel = "base", preenchida = false, className, ...resto }, ref) {
    return (
      <div
        ref={ref}
        className={["s-superficie", className].filter(Boolean).join(" ")}
        data-nivel={nivel}
        data-preenchida={preenchida || undefined}
        {...resto}
      />
    );
  },
);

// ---------------------------------------------------------------------------
// Indicador
// ---------------------------------------------------------------------------

export type SituacaoIndicador = "ok" | "atencao" | "erro" | "neutro" | "ativo";

export interface IndicadorProps extends HTMLAttributes<HTMLSpanElement> {
  situacao?: SituacaoIndicador;
  /** Descrição textual. Obrigatória: cor sozinha não comunica. */
  descricao: string;
  /** Pulsa. Reservado para atividade real, nunca decorativo. */
  pulsando?: boolean;
}

/**
 * Ponto de status.
 *
 * A descrição é obrigatória por decisão de projeto: um ponto colorido não
 * comunica nada para quem não distingue cores, e este componente é usado
 * justamente para dizer se o computador está conectado.
 */
export function Indicador({
  situacao = "neutro",
  descricao,
  pulsando = false,
  className,
  ...resto
}: IndicadorProps) {
  return (
    <span
      className={["s-indicador", className].filter(Boolean).join(" ")}
      data-situacao={situacao}
      data-pulsando={pulsando || undefined}
      {...resto}
    >
      <span className="s-indicador__ponto" aria-hidden="true" />
      <span className="s-indicador__texto">{descricao}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Rotulo
// ---------------------------------------------------------------------------

export interface RotuloProps extends HTMLAttributes<HTMLSpanElement> {
  tamanho?: "2xs" | "xs" | "sm" | "md" | "lg";
  tom?: "principal" | "atenuado" | "sutil";
  /** Números tabulares e fonte monoespaçada, para valores que mudam. */
  numerico?: boolean;
  truncar?: boolean;
}

export function Rotulo({
  tamanho = "sm",
  tom = "principal",
  numerico = false,
  truncar = false,
  className,
  ...resto
}: RotuloProps) {
  return (
    <span
      className={["s-rotulo", className].filter(Boolean).join(" ")}
      data-tamanho={tamanho}
      data-tom={tom}
      data-numerico={numerico || undefined}
      data-truncar={truncar || undefined}
      {...resto}
    />
  );
}
