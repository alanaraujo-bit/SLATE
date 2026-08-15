import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regras de movimento, verificadas no CSS.
 *
 * Um control surface precisa parecer instantâneo: a pessoa toca o botão com a
 * atenção no jogo ou no editor, e qualquer atraso perceptível vira dúvida
 * sobre se o comando saiu. Estas verificações impedem que uma animação
 * generosa demais entre sem ninguém notar.
 */

const aqui = dirname(fileURLToPath(import.meta.url));
const tokens = readFileSync(resolve(aqui, "tokens.css"), "utf8");
const primitivas = readFileSync(resolve(aqui, "primitivas.css"), "utf8");

const semComentarios = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

describe("durações", () => {
  it("nenhuma duração de interação passa de 400ms", () => {
    // Acima disso a interface começa a parecer que está pensando, e o produto
    // vende precisão.
    const declaradas = [
      ...semComentarios(tokens).matchAll(/--s-duration-[\w-]+:\s*(\d+)ms/g),
    ].map((m) => Number.parseInt(m[1]!, 10));

    expect(declaradas.length).toBeGreaterThan(0);
    for (const duracao of declaradas) {
      expect(duracao).toBeLessThanOrEqual(400);
    }
  });

  it("a resposta ao toque é quase imediata", () => {
    const instantaneo = tokens.match(/--s-duration-instant:\s*(\d+)ms/);
    expect(Number.parseInt(instantaneo![1]!, 10)).toBeLessThanOrEqual(100);
  });
});

describe("preferência por menos movimento", () => {
  it("os tokens são neutralizados quando o sistema pede menos movimento", () => {
    expect(tokens).toContain("prefers-reduced-motion: reduce");
  });

  it("todas as durações caem, não apenas algumas", () => {
    // Reduzir só parte delas produz uma interface meio animada, que é pior que
    // qualquer um dos dois extremos.
    const bloco = tokens.slice(tokens.indexOf("prefers-reduced-motion"));
    for (const nome of ["instant", "fast", "normal", "slow"]) {
      expect(bloco, nome).toContain(`--s-duration-${nome}: 0.01ms`);
    }
  });
});

describe("uso do movimento nas primitivas", () => {
  it("as transições usam os tokens, e não valores soltos", () => {
    const limpo = semComentarios(primitivas);
    const transicoes = [...limpo.matchAll(/transition:[^;]+;/g)].map((m) => m[0]);

    expect(transicoes.length).toBeGreaterThan(0);
    for (const transicao of transicoes) {
      // Um tempo escrito à mão escapa da neutralização por preferência do
      // sistema e do orçamento de duração.
      expect(transicao, transicao).not.toMatch(/\d+m?s/);
      expect(transicao).toContain("var(--s-duration");
    }
  });

  it("as animações contínuas são reservadas a atividade real", () => {
    const limpo = semComentarios(primitivas);
    const animacoes = [...limpo.matchAll(/animation:\s*([\w-]+)/g)].map((m) => m[1]);

    // Só duas: a faixa de execução em curso e o pulso de estado ativo. Qualquer
    // animação infinita além dessas é decoração, e decoração que se move
    // distrai quem precisa reagir rápido.
    expect(new Set(animacoes)).toEqual(new Set(["s-botao-carregando", "s-pulsar"]));
  });

  it("o recuo ao toque não acontece em estado inerte", () => {
    // Recuar sem executar nada é a interface mentindo que aceitou o comando.
    expect(primitivas).toMatch(
      /\.s-botao:active:not\(\[aria-disabled="true"\]\):not\(\[aria-busy="true"\]\)/,
    );
  });
});

describe("orçamento de movimento", () => {
  it("existe uma curva própria para resposta tátil", () => {
    expect(tokens).toContain("--s-ease-spring");
  });

  it("as curvas são declaradas como token", () => {
    const usos = [...semComentarios(primitivas).matchAll(/cubic-bezier\([^)]+\)/g)];
    // Uma curva escrita direto na primitiva sai do vocabulário compartilhado e
    // faz um componente se mover diferente dos outros sem motivo.
    expect(usos).toEqual([]);
  });
});
