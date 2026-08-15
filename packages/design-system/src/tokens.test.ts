import { describe, expect, it } from "vitest";
import {
  AA_COMPONENTE,
  AA_TEXTO_NORMAL,
  CORES_CONTROLE_LISTA,
  ESTADOS_INERTES,
  HEX_CORES_CONTROLE,
  TEMA_CLARO,
  TEMA_ESCURO,
  aceitaInteracao,
  contraste,
  hexParaRgb,
  textoSobre,
} from "./tokens";

/**
 * Verificação automatizada dos tokens.
 *
 * Acessibilidade aqui é medida, não julgada por aparência. O Centro de Controle
 * já mostrou por que isso importa: um token de texto que parecia bom reprovou na
 * auditoria por contraste insuficiente, e só apareceu porque uma ferramenta
 * mediu. Estes testes puxam essa verificação para o design system, onde o erro
 * custa mais barato de corrigir.
 */

const temas = [
  ["escuro", TEMA_ESCURO],
  ["claro", TEMA_CLARO],
] as const;

describe.each(temas)("contraste do tema %s", (_nome, tema) => {
  it("texto principal passa em AA sobre a superfície", () => {
    expect(contraste(tema.text, tema.surface)).toBeGreaterThanOrEqual(AA_TEXTO_NORMAL);
  });

  it("texto principal passa em AA sobre o fundo", () => {
    expect(contraste(tema.text, tema.bg)).toBeGreaterThanOrEqual(AA_TEXTO_NORMAL);
  });

  it("texto atenuado passa em AA sobre a superfície", () => {
    expect(contraste(tema.textMuted, tema.surface)).toBeGreaterThanOrEqual(
      AA_TEXTO_NORMAL,
    );
  });

  it("texto sutil passa em AA como texto normal, não apenas como texto grande", () => {
    // Este é o nível que costuma reprovar, porque carrega rótulos pequenos.
    expect(contraste(tema.textSubtle, tema.surface)).toBeGreaterThanOrEqual(
      AA_TEXTO_NORMAL,
    );
  });

  it("texto sutil também passa sobre a superfície elevada", () => {
    expect(contraste(tema.textSubtle, tema.surfaceRaised)).toBeGreaterThanOrEqual(
      AA_TEXTO_NORMAL,
    );
  });

  it("o texto sobre o acento é legível", () => {
    expect(contraste(tema.onAccent, tema.accent)).toBeGreaterThanOrEqual(
      AA_TEXTO_NORMAL,
    );
  });

  it("as cores de status são distinguíveis do fundo", () => {
    for (const chave of ["success", "warning", "danger", "info"] as const) {
      expect(
        contraste(tema[chave], tema.surface),
        `${chave} contra a superfície`,
      ).toBeGreaterThanOrEqual(AA_COMPONENTE);
    }
  });

  it("a borda forte é perceptível contra a superfície", () => {
    // Sem isso, um control surface perde a separação entre um controle e o
    // seguinte, que é justamente o que ele precisa comunicar.
    expect(contraste(tema.borderStrong, tema.surface)).toBeGreaterThan(1.4);
  });

  it("o acento se destaca do texto comum", () => {
    // Se acento e texto tiverem luminância parecida, quem não distingue cor
    // não percebe o que é acionável.
    expect(contraste(tema.accent, tema.surface)).toBeGreaterThanOrEqual(AA_COMPONENTE);
  });
});

describe("paleta de controles", () => {
  it("tem doze cores", () => {
    expect(CORES_CONTROLE_LISTA).toHaveLength(12);
  });

  it("nenhuma cor está repetida", () => {
    const valores = Object.values(HEX_CORES_CONTROLE);
    expect(new Set(valores).size).toBe(valores.length);
  });

  it("toda cor aceita um rótulo legível por cima", () => {
    // A cor do controle é escolha do usuário; um rótulo ilegível transformaria
    // o recurso em problema.
    for (const [nome, hex] of Object.entries(HEX_CORES_CONTROLE)) {
      const texto = textoSobre(hex);
      expect(contraste(texto, hex), `rótulo sobre ${nome}`).toBeGreaterThanOrEqual(
        AA_TEXTO_NORMAL,
      );
    }
  });

  it("toda cor se distingue do fundo escuro", () => {
    for (const [nome, hex] of Object.entries(HEX_CORES_CONTROLE)) {
      expect(
        contraste(hex, TEMA_ESCURO.surface),
        `${nome} contra a superfície`,
      ).toBeGreaterThanOrEqual(AA_COMPONENTE);
    }
  });

  it("cores vizinhas na paleta são distinguíveis entre si", () => {
    // Vizinhas idênticas demais tornam a escolha de cor inútil num toque rápido.
    const lista = CORES_CONTROLE_LISTA;
    for (let i = 0; i < lista.length - 1; i++) {
      const a = HEX_CORES_CONTROLE[lista[i]!];
      const b = HEX_CORES_CONTROLE[lista[i + 1]!];
      expect(a).not.toBe(b);
    }
  });
});

describe("textoSobre", () => {
  it("escolhe texto escuro sobre cor clara", () => {
    expect(textoSobre("#ffffff")).toBe("#0c0f15");
  });

  it("escolhe texto claro sobre cor escura", () => {
    expect(textoSobre("#000000")).toBe("#ffffff");
  });
});

describe("conversão de cor", () => {
  it("aceita hexadecimal de três dígitos", () => {
    expect(hexParaRgb("#fff")).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("aceita com e sem cerquilha", () => {
    expect(hexParaRgb("06080c")).toEqual(hexParaRgb("#06080c"));
  });

  it("rejeita entrada inválida em vez de devolver preto silenciosamente", () => {
    expect(() => hexParaRgb("nao-e-cor")).toThrow(/inválida/i);
  });
});

describe("estados de controle", () => {
  it("estados inertes não aceitam interação", () => {
    for (const estado of ESTADOS_INERTES) {
      expect(aceitaInteracao(estado), estado).toBe(false);
    }
  });

  it("estados ativos aceitam interação", () => {
    for (const estado of ["idle", "hover", "pressed", "active", "error"] as const) {
      expect(aceitaInteracao(estado), estado).toBe(true);
    }
  });

  it("indisponível é inerte — um controle sem Agente não pode parecer clicável", () => {
    expect(aceitaInteracao("unavailable")).toBe(false);
  });
});

describe("contraste (função)", () => {
  it("preto sobre branco é o máximo da escala", () => {
    expect(contraste("#000000", "#ffffff")).toBeCloseTo(21, 1);
  });

  it("uma cor contra ela mesma é o mínimo", () => {
    expect(contraste("#3b8df5", "#3b8df5")).toBeCloseTo(1, 5);
  });

  it("é simétrico", () => {
    expect(contraste("#eef1f6", "#0c0f15")).toBeCloseTo(
      contraste("#0c0f15", "#eef1f6"),
      5,
    );
  });
});
