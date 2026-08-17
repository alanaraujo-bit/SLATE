import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { CAMINHOS_MARCAS, MARCAS, Marca, type NomeMarca } from "./marcas";
import { cabeNaGrade, limitesDoCaminho } from "./limites-svg";

describe("marcas de serviço", () => {
  it("desenha toda marca declarada, e nenhuma a mais", () => {
    // O par disso é `CONTROLES_ATALHOS` na PWA e `ACOES_FIXAS` no Agente: uma
    // marca sem caminho vira uma tecla vazia, e um caminho sem marca é peso
    // morto no pacote que ninguém percebe sumir.
    expect(Object.keys(CAMINHOS_MARCAS).sort()).toEqual([...MARCAS].sort());
  });

  it.each(MARCAS)("%s cabe na grade de 24", (nome) => {
    // Vazar a grade não quebra nada visível no teste — só corta a marca na
    // tecla, e só em alguns tamanhos.
    expect(cabeNaGrade(CAMINHOS_MARCAS[nome]), `${nome}: ${JSON.stringify(limitesDoCaminho(CAMINHOS_MARCAS[nome]))}`).toBe(true);
  });

  it.each(MARCAS)("%s ocupa a grade de verdade", (nome) => {
    // Uma marca miúda no meio da caixa fica visualmente menor que os ícones ao
    // lado, e o painel passa a parecer desalinhado sem que ninguém saiba dizer
    // por quê. Exigir largura e altura reais é o que mantém o conjunto coeso.
    const { minX, minY, maxX, maxY } = limitesDoCaminho(CAMINHOS_MARCAS[nome]);
    expect(maxX - minX).toBeGreaterThan(12);
    expect(maxY - minY).toBeGreaterThan(12);
  });

  // Nem toda marca tem furo — um monograma cheio como o "N" é uma forma só, e
  // isso é correto. As que têm (play vazado, hastes, barras) precisam do furo
  // de verdade: pintar o vazio da cor do fundo funciona sobre a superfície
  // neutra do catálogo e some assim que a marca encosta numa tecla colorida.
  it.each(["youtube", "twitch", "prime", "disney"] as const)("%s vaza o furo em vez de pintá-lo", (nome) => {
    expect((CAMINHOS_MARCAS[nome].match(/[Mm]/g) ?? []).length).toBeGreaterThan(1);
  });

  it("herda a cor do contexto em vez de trazer a própria", () => {
    // A cor mora no CSS (`.marca-servico--*`). Fixá-la aqui obrigaria a uma
    // segunda cópia para o catálogo apagado do editor.
    for (const caminho of Object.values(CAMINHOS_MARCAS)) {
      expect(caminho).not.toMatch(/#[0-9a-f]{3,8}/i);
    }
  });

  it("é decorativa por padrão e nomeável quando precisa", () => {
    const { container, rerender } = render(<Marca nome="netflix" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("role")).toBeNull();

    rerender(<Marca nome="netflix" titulo="Netflix" />);
    const nomeada = container.querySelector("svg")!;
    expect(nomeada.getAttribute("role")).toBe("img");
    expect(nomeada.getAttribute("aria-label")).toBe("Netflix");
    expect(nomeada.getAttribute("aria-hidden")).toBeNull();
  });

  it("preenche e vaza pelo evenodd", () => {
    const { container } = render(<Marca nome={"youtube" satisfies NomeMarca} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("fill")).toBe("currentColor");
    expect(svg.getAttribute("fill-rule")).toBe("evenodd");
  });
});
