import { describe, expect, it } from "vitest";
import { lerTokens, type MapaTokens } from "./ler-tokens";
import { AA_COMPONENTE, AA_TEXTO_NORMAL, contraste } from "./tokens";

/**
 * Contraste medido no CSS de verdade, não numa cópia.
 *
 * A suíte irmã (`tokens.test.ts`) verifica as funções de cor e a paleta de
 * controles. Esta verifica o arquivo que o navegador realmente carrega — foi
 * escrita depois de um token ser corrigido em um dos dois blocos de tema claro
 * e não no outro, com os testes seguindo verdes o tempo todo.
 */

const tokens = lerTokens();

const temas = [
  ["escuro", tokens.escuro],
  ["claro (escolha do usuário)", tokens.claroExplicito],
  ["claro (preferência do sistema)", tokens.claroPorPreferencia],
] as const;

describe("os dois caminhos do tema claro não podem divergir", () => {
  it("produzem exatamente os mesmos valores", () => {
    // Este é o teste que teria pegado o erro que motivou este arquivo: o ciano
    // foi corrigido no bloco da media query e esquecido no bloco explícito.
    const explicito = tokens.claroExplicito;
    const preferencia = tokens.claroPorPreferencia;

    const divergentes = Object.keys(explicito)
      .filter((nome) => explicito[nome] !== preferencia[nome])
      .map((nome) => `${nome}: ${explicito[nome]} vs ${preferencia[nome]}`);

    expect(divergentes, "tokens divergentes entre os dois blocos").toEqual([]);
  });
});

describe.each(temas)("contraste no CSS — tema %s", (_nome, tema: MapaTokens) => {
  const cor = (nome: string): string => {
    const valor = tema[nome];
    if (!valor) throw new Error(`Token ausente: ${nome}`);
    return valor;
  };

  it("texto principal passa em AA sobre a superfície", () => {
    expect(contraste(cor("--s-text"), cor("--s-surface"))).toBeGreaterThanOrEqual(
      AA_TEXTO_NORMAL,
    );
  });

  it("texto atenuado passa em AA sobre a superfície", () => {
    expect(
      contraste(cor("--s-text-muted"), cor("--s-surface")),
    ).toBeGreaterThanOrEqual(AA_TEXTO_NORMAL);
  });

  it("texto sutil passa em AA sobre a superfície", () => {
    expect(
      contraste(cor("--s-text-subtle"), cor("--s-surface")),
    ).toBeGreaterThanOrEqual(AA_TEXTO_NORMAL);
  });

  it("texto sutil passa em AA sobre a superfície elevada", () => {
    expect(
      contraste(cor("--s-text-subtle"), cor("--s-surface-raised")),
    ).toBeGreaterThanOrEqual(AA_TEXTO_NORMAL);
  });

  it("texto principal passa em AA sobre o fundo", () => {
    expect(contraste(cor("--s-text"), cor("--s-bg"))).toBeGreaterThanOrEqual(
      AA_TEXTO_NORMAL,
    );
  });

  it("o texto sobre o acento é legível", () => {
    expect(
      contraste(cor("--s-on-accent"), cor("--s-accent")),
    ).toBeGreaterThanOrEqual(AA_TEXTO_NORMAL);
  });

  it("as cores de status se distinguem da superfície", () => {
    for (const nome of ["--s-success", "--s-warning", "--s-danger", "--s-info"]) {
      expect(
        contraste(cor(nome), cor("--s-surface")),
        `${nome} contra a superfície`,
      ).toBeGreaterThanOrEqual(AA_COMPONENTE);
    }
  });

  it("o acento se distingue da superfície", () => {
    expect(contraste(cor("--s-accent"), cor("--s-surface"))).toBeGreaterThanOrEqual(
      AA_COMPONENTE,
    );
  });
});

describe("integridade do arquivo de tokens", () => {
  it("nenhuma referência var() ficou sem resolver", () => {
    for (const [nome, valor] of Object.entries(tokens.escuro)) {
      expect(valor, `${nome} referencia algo inexistente`).not.toBe("");
    }
  });

  it("todo token semântico de cor existe nos três temas", () => {
    const semanticos = [
      "--s-bg",
      "--s-surface",
      "--s-surface-raised",
      "--s-border",
      "--s-border-strong",
      "--s-text",
      "--s-text-muted",
      "--s-text-subtle",
      "--s-accent",
      "--s-on-accent",
      "--s-success",
      "--s-warning",
      "--s-danger",
      "--s-info",
    ];

    for (const [nome, tema] of temas) {
      for (const token of semanticos) {
        expect(tema[token], `${token} ausente no tema ${nome}`).toBeTruthy();
      }
    }
  });

  it("a paleta de controles está completa", () => {
    const cores = [
      "red",
      "orange",
      "amber",
      "yellow",
      "lime",
      "green",
      "teal",
      "cyan",
      "blue",
      "indigo",
      "violet",
      "pink",
    ];
    for (const c of cores) {
      expect(tokens.escuro[`--s-control-${c}`], `--s-control-${c}`).toBeTruthy();
    }
  });
});
