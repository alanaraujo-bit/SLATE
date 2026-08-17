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

    /*
     * A régua é `infinite`, e não a existência de animação.
     *
     * O que cansa e distrai é o que se repete para sempre ao lado de quem está
     * tentando ler ou digitar. Uma animação que roda uma vez na abertura e para
     * não tem esse efeito — e a versão anterior deste teste proibia as duas
     * coisas juntas, o que obrigaria a afrouxar a lista toda vez que uma
     * entrada fosse animada. Verificar o laço direto é mais estrito onde
     * importa e mais honesto sobre o motivo.
     */
    const infinitas = [...limpo.matchAll(/animation:\s*([\w-]+)[^;]*infinite/g)].map(
      (m) => m[1],
    );

    // Só duas: a faixa de execução em curso e o pulso de estado ativo. As duas
    // significam "algo está acontecendo agora"; qualquer outra seria decoração.
    expect(new Set(infinitas)).toEqual(new Set(["s-botao-carregando", "s-pulsar"]));
  });

  it("toda animação de uma vez só é desligada quando se pede menos movimento", () => {
    const limpo = semComentarios(primitivas);

    /*
     * As durações caem a zero por token, mas `animation` com nome próprio não
     * passa por elas: o nome carrega a própria duração, e o bloco de
     * preferência precisa desligá-la explicitamente. Sem esta verificação, uma
     * animação de entrada nova entraria e continuaria rodando exatamente para
     * quem pediu que não rodasse.
     */
    /*
     * Percorre as regras como `seletor { corpo }` em vez de procurar o nome da
     * animação e caçar o seletor para trás com uma expressão: a primeira versão
     * fazia isso e casou com `.25rem` no meio de um valor, o que dava um teste
     * que falhava pelo motivo errado. Um par seletor/corpo é o que se quer
     * saber, então é o que se lê.
     */
    const regras = [...limpo.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
      seletor: m[1]!.trim(),
      corpo: m[2]!,
    }));

    const CONTINUAS = ["s-botao-carregando", "s-pulsar"];
    const deUmaVez = regras.filter((r) => {
      const nome = r.corpo.match(/animation:\s*([\w-]+)/)?.[1];
      return nome !== undefined && !CONTINUAS.includes(nome) && !r.corpo.includes("infinite");
    });

    const desligadas = new Set(
      regras
        .filter((r) => /animation:\s*none/.test(r.corpo))
        .flatMap((r) => r.seletor.split(",").map((s) => s.trim())),
    );

    expect(deUmaVez.length).toBeGreaterThan(0);
    for (const regra of deUmaVez) {
      for (const seletor of regra.seletor.split(",").map((s) => s.trim())) {
        expect(
          desligadas.has(seletor),
          `${seletor} continua animando com movimento reduzido`,
        ).toBe(true);
      }
    }
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
