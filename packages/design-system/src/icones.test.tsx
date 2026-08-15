import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  CAMINHOS_ICONES,
  ICONES,
  Icone,
  IconePlay,
  NOMES_ICONES,
  type NomeIcone,
} from "./icones";
import { cabeNaGrade, limitesDoCaminho } from "./limites-svg";

/**
 * Coerência do conjunto de ícones.
 *
 * Num control surface o ícone é muitas vezes a única coisa que o botão mostra.
 * Ícones de pesos ou grades diferentes viram ruído — e ruído aqui significa
 * apertar o botão errado com a atenção em outro lugar.
 */

describe("conjunto de ícones", () => {
  it("tem um tamanho útil para começar", () => {
    expect(NOMES_ICONES.length).toBeGreaterThanOrEqual(24);
  });

  it("todo nome declarado tem componente correspondente", () => {
    for (const nome of NOMES_ICONES) {
      expect(ICONES[nome], nome).toBeDefined();
    }
  });

  it("nenhum desenho está duplicado", () => {
    // Dois nomes com o mesmo desenho quase sempre significam que um deles
    // ficou por fazer.
    const caminhos = Object.values(CAMINHOS_ICONES);
    const duplicados = caminhos.filter((c, i) => caminhos.indexOf(c) !== i);
    expect(duplicados).toEqual([]);
  });

  it("todos usam a mesma grade", () => {
    for (const nome of NOMES_ICONES) {
      const { container, unmount } = render(<Icone nome={nome} />);
      expect(container.querySelector("svg"), nome).toHaveAttribute(
        "viewBox",
        "0 0 24 24",
      );
      unmount();
    }
  });

  it("todos usam a mesma espessura de traço", () => {
    for (const nome of NOMES_ICONES) {
      const { container, unmount } = render(<Icone nome={nome} />);
      expect(container.querySelector("svg"), nome).toHaveAttribute(
        "stroke-width",
        "1.5",
      );
      unmount();
    }
  });

  it("todos herdam a cor do contexto", () => {
    // Sem currentColor, cada cor de controle exigiria uma variante do ícone.
    for (const nome of NOMES_ICONES) {
      const { container, unmount } = render(<Icone nome={nome} />);
      expect(container.querySelector("svg"), nome).toHaveAttribute(
        "stroke",
        "currentColor",
      );
      unmount();
    }
  });

  it("nenhum desenho sai da grade", () => {
    // Desenho fora da caixa desalinha o ícone em relação aos vizinhos.
    //
    // A verificação rastreia a posição corrente porque comandos em minúscula
    // usam coordenadas relativas: um -6.5 legítimo pareceria coordenada fora
    // da grade para uma checagem que só olhasse os números soltos.
    //
    // Limitação conhecida: só os pontos finais de cada segmento são medidos,
    // então um arco pode se afastar deles sem ser detectado. Serve para pegar
    // vazamento claro, não para provar que todo traço cabe. Uma verificação
    // exata exigiria achatar as curvas, e o custo não se justifica para o que
    // ela acrescentaria.
    for (const [nome, caminho] of Object.entries(CAMINHOS_ICONES)) {
      const { minX, minY, maxX, maxY } = limitesDoCaminho(caminho);
      expect(
        cabeNaGrade(caminho),
        `${nome}: x de ${minX} a ${maxX}, y de ${minY} a ${maxY}`,
      ).toBe(true);
    }
  });
});

describe("acessibilidade dos ícones", () => {
  it("é decorativo por padrão", () => {
    // Quase sempre acompanha texto; anunciá-lo seria repetição.
    const { container } = render(<IconePlay />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("vira imagem nomeada quando recebe título", () => {
    render(<IconePlay titulo="Reproduzir" />);
    expect(screen.getByRole("img", { name: "Reproduzir" })).toBeTruthy();
  });

  it("deixa de ser escondido quando tem título", () => {
    const { container } = render(<IconePlay titulo="Reproduzir" />);
    expect(container.querySelector("svg")).not.toHaveAttribute("aria-hidden");
  });
});

describe("dimensionamento", () => {
  it("usa 20 por padrão", () => {
    const { container } = render(<IconePlay />);
    expect(container.querySelector("svg")).toHaveAttribute("width", "20");
  });

  it("aceita tamanho numérico", () => {
    const { container } = render(<IconePlay tamanho={32} />);
    expect(container.querySelector("svg")).toHaveAttribute("width", "32");
  });

  it("aceita tamanho com unidade CSS", () => {
    const { container } = render(<IconePlay tamanho="1.5rem" />);
    expect(container.querySelector("svg")).toHaveAttribute("width", "1.5rem");
  });
});

describe("Icone por nome", () => {
  it("renderiza a partir de uma string, como vem do banco", () => {
    const nome: NomeIcone = "Terminal";
    const { container } = render(<Icone nome={nome} />);
    expect(container.querySelector("path")).toHaveAttribute(
      "d",
      CAMINHOS_ICONES.Terminal,
    );
  });
});
