import type { CSSProperties } from "react";

/**
 * O palco — a marca do SLATE em três dimensões.
 *
 * O ícone do produto está descrito no próprio `slate.svg`: "uma superfície de
 * controle vista em perspectiva: uma grade de células, uma delas acesa". Este
 * componente é essa descrição construída como objeto: doze teclas numa placa
 * inclinada, com uma acesa.
 *
 * Ele vive no design system, e não dentro de um dos apps, porque é a mesma
 * marca nos dois — a janela do Agente e a superfície no celular mostram o mesmo
 * objeto na tela de entrada, e é isso que faz parear um com o outro parecer
 * óbvio. Duplicar o desenho garantiria que uma das cópias envelhecesse.
 *
 * Sobre movimento, que nesta base é assunto sério (§36): **nada aqui se mexe
 * sozinho**. A tecla acesa muda quando a pessoa avança no formulário, e a
 * inclinação responde ao ponteiro dela. Uma animação em laço ao lado de um
 * campo de senha puxaria o olho de quem está digitando — a única exceção é a
 * onda de entrada, que acontece uma vez na abertura e nunca mais.
 */

/** Doze teclas: três fileiras de quatro, como a grade do ícone. */
const TECLAS = Array.from({ length: 12 }, (_, i) => i);

export interface PalcoProps {
  /**
   * Em que ponto do formulário a pessoa está. Cada passo acende uma tecla
   * diferente; o último acende a superfície inteira.
   *
   * Quem traduz passo em posição é o CSS, e não este componente: assim a
   * aparência fica inteira num lugar só, em vez de virar uma tabela de índices
   * aqui que ninguém conseguiria relacionar com o que aparece na tela.
   *
   * O passo deve derivar de qual campo está em foco, **nunca** do que foi
   * digitado. Um palco que reagisse a cada caractere mostraria o tamanho da
   * senha para quem olhasse a tela por cima do ombro.
   */
  passo: number;
}

export function Palco({ passo }: PalcoProps) {
  return (
    /*
     * São três elementos, e o motivo é concreto.
     *
     * `overflow: hidden` no mesmo elemento que carrega `transform-style:
     * preserve-3d` achata o contexto 3D em vários motores: as teclas voltam a
     * ser retângulos no plano da tela e o efeito some sem erro nenhum aparecer.
     * Por isso um elemento corta, outro projeta e o terceiro é a placa.
     *
     * `aria-hidden` porque isto é a marca desenhada: quem usa leitor de tela
     * recebe o nome do produto pelo texto ao lado, e uma grade de doze caixas
     * vazias anunciada em voz alta seria ruído puro.
     */
    <div className="s-palco" aria-hidden="true">
      <div className="s-palco__cena">
        <div className="s-palco__placa" data-passo={passo}>
          {TECLAS.map((i) => (
            <span
              key={i}
              className="s-palco__tecla"
              // O índice serve ao escalonamento da onda de entrada, no CSS.
              style={{ "--i": i } as CSSProperties}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Liga a inclinação da placa ao ponteiro.
 *
 * É o que transforma a placa de imagem em objeto: perspectiva parada o olho lê
 * como desenho, perspectiva que responde ele lê como coisa. O movimento é de
 * resposta — não acontece nada até a pessoa mexer o mouse.
 *
 * Devolve os dois manipuladores para aplicar no elemento que contém o palco,
 * que costuma ser maior que ele: a placa responde à área toda em volta, e não
 * só ao punhado de pixels que ela ocupa.
 */
export function usarInclinacao() {
  const alvo = (elemento: HTMLElement) =>
    elemento.querySelector<HTMLElement>(".s-palco__placa");

  return {
    onPointerMove: (evento: { currentTarget: HTMLElement; clientX: number; clientY: number }) => {
      /*
       * Quem pediu menos movimento no sistema não recebe nada disto.
       *
       * Os tokens de duração já caem a zero sozinhos, mas estas duas
       * propriedades são escritas em estilo embutido e passariam por cima —
       * a placa continuaria girando sob o ponteiro. Por isso a checagem é
       * explícita, e fica aqui em vez de em cada app.
       */
      if (
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        return;
      }

      const placa = alvo(evento.currentTarget);
      if (!placa) return;

      const area = evento.currentTarget.getBoundingClientRect();
      // Posição do ponteiro de -0,5 a 0,5 em cada eixo, a partir do centro.
      const x = (evento.clientX - area.left) / area.width - 0.5;
      const y = (evento.clientY - area.top) / area.height - 0.5;

      // Oito graus de amplitude: o suficiente para a placa parecer sólida,
      // longe do bastante para não virar aquele cartão que gira demais e enjoa.
      placa.style.setProperty("--giro-x", `${(-y * 8).toFixed(2)}deg`);
      placa.style.setProperty("--giro-y", `${(x * 8).toFixed(2)}deg`);
    },

    onPointerLeave: (evento: { currentTarget: HTMLElement }) => {
      // Remover em vez de zerar: a placa volta ao repouso declarado no CSS, e
      // não a um zero escrito aqui que sairia de sincronia com ele.
      const placa = alvo(evento.currentTarget);
      if (!placa) return;
      placa.style.removeProperty("--giro-x");
      placa.style.removeProperty("--giro-y");
    },
  };
}

/** Os passos que o palco entende, nomeados para não virar número solto. */
export const PASSO_PALCO = {
  repouso: 0,
  email: 1,
  senha: 2,
  entrando: 3,
} as const;
