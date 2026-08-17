import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Palco, PASSO_PALCO, usarInclinacao } from "./palco";

/**
 * O palco é a marca, e não um enfeite — por isso tem teste.
 *
 * O que se verifica aqui são as três coisas que, se quebrarem, quebram em
 * silêncio: a estrutura de três camadas que o 3D exige, o palco não falar com
 * leitor de tela, e o movimento respeitar quem pediu menos movimento.
 */

describe("estrutura", () => {
  it("tem as três camadas que o contexto 3D exige", () => {
    const { container } = render(<Palco passo={PASSO_PALCO.repouso} />);

    /*
     * Recorte, cena e placa precisam ser elementos separados: `overflow:
     * hidden` no mesmo elemento que carrega `transform-style: preserve-3d`
     * achata o contexto 3D em vários motores, e as teclas voltam a ser
     * retângulos no plano da tela. O efeito sumiria sem erro nenhum aparecer,
     * que é justamente o tipo de regressão que precisa de teste.
     */
    expect(container.querySelector(".s-palco")).toBeTruthy();
    expect(container.querySelector(".s-palco > .s-palco__cena")).toBeTruthy();
    expect(container.querySelector(".s-palco__cena > .s-palco__placa")).toBeTruthy();
  });

  it("tem doze teclas, como a grade do ícone", () => {
    const { container } = render(<Palco passo={PASSO_PALCO.repouso} />);
    expect(container.querySelectorAll(".s-palco__tecla")).toHaveLength(12);
  });

  it("cada tecla carrega o índice que escalona a onda de entrada", () => {
    const { container } = render(<Palco passo={PASSO_PALCO.repouso} />);
    const teclas = [...container.querySelectorAll<HTMLElement>(".s-palco__tecla")];

    // Sem o índice, todas as teclas entram ao mesmo tempo e a onda vira um
    // piscar único — perde justamente o que faz a grade parecer uma superfície.
    expect(teclas.map((t) => t.style.getPropertyValue("--i"))).toEqual(
      Array.from({ length: 12 }, (_, i) => String(i)),
    );
  });

  it("o passo vai para o DOM, porque é o CSS que decide qual tecla acende", () => {
    const { container } = render(<Palco passo={PASSO_PALCO.senha} />);
    expect(
      container.querySelector(".s-palco__placa")?.getAttribute("data-passo"),
    ).toBe(String(PASSO_PALCO.senha));
  });
});

describe("o CSS e o componente combinam", () => {
  /*
   * Existe um acoplamento aqui, e ele é invisível: o CSS acende a tecla por
   * `nth-child`, com o índice escrito à mão, enquanto o componente decide
   * quantas teclas existem. Mudar a contagem no TypeScript ou reordenar a
   * grade não quebra teste nenhum de renderização — só faz a marca acender a
   * tecla errada, ou nenhuma, e isso ninguém percebe até ver a tela.
   *
   * Estes dois testes leem o CSS de verdade e comparam com o componente de
   * verdade, que é a única forma de o acoplamento parar de ser silencioso.
   */
  const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "primitivas.css"), "utf8");

  const indices = [...css.matchAll(/\.s-palco__tecla:nth-child\((\d+)\)/g)].map((m) =>
    Number.parseInt(m[1]!, 10),
  );

  it("todo índice que o CSS acende existe na grade", () => {
    const { container } = render(<Palco passo={PASSO_PALCO.repouso} />);
    const total = container.querySelectorAll(".s-palco__tecla").length;

    expect(indices.length).toBeGreaterThan(0);
    for (const indice of indices) {
      // nth-child conta a partir de 1: um índice acima do total simplesmente
      // não casa com nada, e a marca fica sem tecla acesa em silêncio.
      expect(indice, `nth-child(${indice}) não existe numa grade de ${total}`).toBeLessThanOrEqual(
        total,
      );
    }
  });

  it("todo passo do componente tem uma posição declarada no CSS", () => {
    for (const [nome, passo] of Object.entries(PASSO_PALCO)) {
      // O passo "entrando" acende a placa inteira e não aparece como
      // nth-child; os demais precisam de uma posição própria.
      const declarado =
        css.includes(`.s-palco__placa[data-passo="${passo}"] .s-palco__tecla:nth-child`) ||
        css.includes(`.s-palco__placa[data-passo="${passo}"] .s-palco__tecla {`);

      expect(declarado, `o passo "${nome}" (${passo}) não acende nada`).toBe(true);
    }
  });
});

describe("acessibilidade", () => {
  it("é escondido de leitor de tela", () => {
    // É a marca desenhada: quem usa leitor recebe o nome do produto pelo texto
    // ao lado, e doze caixas vazias anunciadas em voz alta seriam ruído puro.
    const { container } = render(<Palco passo={PASSO_PALCO.repouso} />);
    expect(container.querySelector(".s-palco")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
    expect(screen.queryAllByRole("img")).toHaveLength(0);
  });
});

describe("inclinação pelo ponteiro", () => {
  const elementoFalso = () => {
    const placa = document.createElement("div");
    placa.className = "s-palco__placa";
    const alvo = document.createElement("div");
    alvo.appendChild(placa);
    alvo.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 200, height: 100 }) as DOMRect;
    return { alvo, placa };
  };

  const comPreferencia = (reduzido: boolean) => {
    vi.stubGlobal("matchMedia", (consulta: string) => ({
      matches: reduzido && consulta.includes("prefers-reduced-motion"),
      media: consulta,
    }));
  };

  it("escreve a inclinação a partir da posição do ponteiro", () => {
    comPreferencia(false);
    const { alvo, placa } = elementoFalso();

    // Canto superior esquerdo: giro negativo em Y, positivo em X.
    usarInclinacao().onPointerMove({ currentTarget: alvo, clientX: 0, clientY: 0 });

    expect(placa.style.getPropertyValue("--giro-y")).toBe("-4.00deg");
    expect(placa.style.getPropertyValue("--giro-x")).toBe("4.00deg");
  });

  it("não passa dos oito graus de amplitude", () => {
    comPreferencia(false);
    const { alvo, placa } = elementoFalso();

    // Canto oposto, o extremo do alcance.
    usarInclinacao().onPointerMove({ currentTarget: alvo, clientX: 200, clientY: 100 });

    for (const eixo of ["--giro-x", "--giro-y"]) {
      const graus = Number.parseFloat(placa.style.getPropertyValue(eixo));
      // Mais que isso vira aquele cartão que gira demais e enjoa.
      expect(Math.abs(graus), eixo).toBeLessThanOrEqual(4);
    }
  });

  it("não escreve nada quando o sistema pede menos movimento", () => {
    /*
     * Esta é a verificação que mais importa das três.
     *
     * A inclinação é escrita em estilo embutido, e estilo embutido passa por
     * cima dos tokens de duração que o CSS neutraliza — a placa continuaria
     * girando sob o ponteiro exatamente para quem pediu que nada girasse.
     */
    comPreferencia(true);
    const { alvo, placa } = elementoFalso();

    usarInclinacao().onPointerMove({ currentTarget: alvo, clientX: 0, clientY: 0 });

    expect(placa.style.getPropertyValue("--giro-x")).toBe("");
    expect(placa.style.getPropertyValue("--giro-y")).toBe("");
  });

  it("devolve a placa ao repouso quando o ponteiro sai", () => {
    comPreferencia(false);
    const { alvo, placa } = elementoFalso();
    const inclinacao = usarInclinacao();

    inclinacao.onPointerMove({ currentTarget: alvo, clientX: 0, clientY: 0 });
    inclinacao.onPointerLeave({ currentTarget: alvo });

    // Removida, e não zerada: a placa volta ao repouso declarado no CSS, em vez
    // de a um zero escrito no componente que sairia de sincronia com ele.
    expect(placa.style.getPropertyValue("--giro-x")).toBe("");
    expect(placa.style.getPropertyValue("--giro-y")).toBe("");
  });
});
