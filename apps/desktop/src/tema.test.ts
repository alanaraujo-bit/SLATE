// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { aplicarTema, temaGuardado } from "./tema";

const aqui = dirname(fileURLToPath(import.meta.url));
const estilos = readFileSync(resolve(aqui, "estilos.css"), "utf8");

describe("tema da janela", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
    window.localStorage.clear();
  });

  it("seguir o sistema significa não escrever atributo nenhum", () => {
    /*
     * Este é o detalhe que faria o modo "Sistema" parar de funcionar sem
     * ninguém perceber: os tokens decidem pelas consultas de mídia quando não
     * há `data-theme`. Escrever "system" ali deixaria os seletores sem
     * corresponder a nada, e a janela ficaria presa nas cores base ignorando
     * o Windows.
     */
    aplicarTema("escuro");
    aplicarTema("sistema");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("escolher um tema vence a preferência do sistema nas duas direções", () => {
    aplicarTema("claro");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    aplicarTema("escuro");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("valor estranho no armazenamento vira o padrão, sem quebrar", () => {
    window.localStorage.setItem("slate.tema", "roxo");
    expect(temaGuardado()).toBe("sistema");
  });
});

describe("cores da janela", () => {
  it("nenhuma cor é escrita à mão fora dos tokens", () => {
    /*
     * A regra que faz o tema claro nascer certo em vez de ser remendado: um
     * literal escapa das verificações de contraste do design system em
     * silêncio, e o defeito só aparece quando alguém troca de tema e lê um
     * texto cinza sobre cinza.
     *
     * A exceção é o QR Code, que precisa de preto e branco fixos para a câmera
     * decodificar — e ela mora no TSX, com comentário, não aqui.
     */
    const semComentarios = estilos.replace(/\/\*[\s\S]*?\*\//g, "");
    const literais = [
      ...semComentarios.matchAll(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g),
    ].map((m) => m[0]);

    expect(literais).toEqual([]);
  });

  it("o anel de foco é aplicado como sombra, nunca como cor de contorno", () => {
    /*
     * `--s-ring-focus` vale `0 0 0 2px …, 0 0 0 4px …` — uma sombra, não uma
     * cor. Escrito como `outline: 2px solid var(--s-ring-focus)` o navegador
     * descarta a declaração inteira **em silêncio**, e o foco por teclado
     * simplesmente desaparece: nada quebra, nada avisa, e só quem navega sem
     * mouse percebe. Foi o que aconteceu aqui.
     */
    expect(estilos).not.toMatch(/outline:[^;]*--s-ring-focus/);
    expect(estilos).toMatch(/box-shadow: var\(--s-ring-focus\)/);
  });

  it("todo elemento acionável tem estado de foco visível", () => {
    // Um controle sem `:focus-visible` é invisível para quem navega por
    // teclado, e a janela inteira do Agente é operável sem mouse.
    const semComentarios = estilos.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const seletor of [".lateral__aba", ".botao", ".cor"]) {
      expect(semComentarios, seletor).toContain(`${seletor}:focus-visible`);
    }
  });

  it("o movimento é desligado quando o sistema pede menos movimento", () => {
    /*
     * Os tokens de duração já caem a zero sozinhos, mas `animation` com nome
     * próprio e `transform` não passam por eles. Sem desligar explicitamente,
     * sobra justamente o movimento que a pessoa pediu para não ver.
     */
    const bloco = estilos.slice(estilos.lastIndexOf("prefers-reduced-motion"));
    expect(bloco).toContain("animation: none");
    expect(bloco).toContain("transform: none");
  });

  it("as transições saem dos tokens de duração", () => {
    // Os tokens são testados no design system para nunca passar de 400ms e
    // para cair a zero quando o sistema pede menos movimento. Um valor solto
    // aqui escaparia das duas garantias.
    const semComentarios = estilos.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const transicao of semComentarios.match(/transition:[^;]+;/g) ?? []) {
      expect(transicao, transicao).toMatch(/var\(--s-duration-/);
    }
  });
});
