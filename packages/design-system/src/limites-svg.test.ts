import { describe, expect, it } from "vitest";
import { cabeNaGrade, limitesDoCaminho, pontosDoCaminho } from "./limites-svg";

/**
 * O leitor de caminhos precisa estar certo antes de servir para auditar os
 * ícones — uma verificação errada é pior que verificação nenhuma, porque
 * aprova o que deveria reprovar.
 */

describe("pontosDoCaminho", () => {
  it("lê coordenadas absolutas", () => {
    expect(pontosDoCaminho("M4 6L10 12")).toEqual([
      { x: 4, y: 6 },
      { x: 10, y: 12 },
    ]);
  });

  it("acumula coordenadas relativas a partir da posição corrente", () => {
    // É a distinção que a verificação ingênua errava.
    expect(pontosDoCaminho("M4 6l6 6")).toEqual([
      { x: 4, y: 6 },
      { x: 10, y: 12 },
    ]);
  });

  it("trata linha vertical relativa", () => {
    expect(pontosDoCaminho("M8 5.5v13")).toEqual([
      { x: 8, y: 5.5 },
      { x: 8, y: 18.5 },
    ]);
  });

  it("trata linha horizontal absoluta", () => {
    expect(pontosDoCaminho("M4 6H20")).toEqual([
      { x: 4, y: 6 },
      { x: 20, y: 6 },
    ]);
  });

  it("repete o comando quando vêm números sem letra", () => {
    expect(pontosDoCaminho("M2 2L4 4 6 6")).toEqual([
      { x: 2, y: 2 },
      { x: 4, y: 4 },
      { x: 6, y: 6 },
    ]);
  });

  it("números após M viram L, como manda a especificação", () => {
    expect(pontosDoCaminho("M2 2 8 8")).toEqual([
      { x: 2, y: 2 },
      { x: 8, y: 8 },
    ]);
  });

  it("usa o ponto final de uma curva, ignorando os de controle", () => {
    expect(pontosDoCaminho("M2 2C4 0 8 0 10 2")).toEqual([
      { x: 2, y: 2 },
      { x: 10, y: 2 },
    ]);
  });

  it("usa o ponto final de um arco", () => {
    expect(pontosDoCaminho("M12 6a6 6 0 1 0 0 12")).toEqual([
      { x: 12, y: 6 },
      { x: 12, y: 18 },
    ]);
  });

  it("fechar o caminho volta ao início", () => {
    const pontos = pontosDoCaminho("M4 4L10 4L10 10Z");
    expect(pontos.at(-1)).toEqual({ x: 10, y: 10 });
  });

  it("não trava com entrada vazia", () => {
    expect(pontosDoCaminho("")).toEqual([]);
  });

  it("para em vez de travar diante de caminho malformado", () => {
    expect(() => pontosDoCaminho("M4")).not.toThrow();
  });
});

describe("limitesDoCaminho", () => {
  it("calcula a caixa que envolve o desenho", () => {
    expect(limitesDoCaminho("M4 6L10 12")).toEqual({
      minX: 4,
      minY: 6,
      maxX: 10,
      maxY: 12,
    });
  });
});

describe("cabeNaGrade", () => {
  it("aceita desenho dentro da grade", () => {
    expect(cabeNaGrade("M4 4L20 20")).toBe(true);
  });

  it("recusa desenho que passa da grade", () => {
    expect(cabeNaGrade("M4 4L30 20")).toBe(false);
  });

  it("recusa desenho com coordenada negativa", () => {
    expect(cabeNaGrade("M-5 4L20 20")).toBe(false);
  });

  it("aceita um triângulo com deslocamento relativo negativo", () => {
    // O caso que reprovava por engano: -6.5 é um delta, não uma coordenada.
    expect(cabeNaGrade("M8 5.5v13l10.5-6.5z")).toBe(true);
  });
});
