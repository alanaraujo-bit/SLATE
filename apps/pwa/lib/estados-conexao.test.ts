import { describe, expect, it } from "vitest";
import {
  DESCRICOES,
  ESTADOS_CONEXAO,
  descrever,
  estaTentando,
  exigeAtencao,
  podeOperar,
} from "./estados-conexao";

/**
 * O mandato §37 pede que a interface explique o estado sem parecer quebrada.
 * Estes testes tratam isso como requisito verificável e não como intenção:
 * todo estado precisa ter texto, todo estado que a pessoa tem que resolver
 * precisa dizer o que fazer, e nenhum estado sem conexão pode deixar controle
 * acionável.
 */

describe("cobertura dos estados", () => {
  it("todo estado do protocolo tem descrição", () => {
    // Um estado sem tratamento apareceria como tela vazia justamente no
    // momento em que algo deu errado.
    for (const estado of ESTADOS_CONEXAO) {
      expect(DESCRICOES[estado], estado).toBeDefined();
    }
  });

  it("não há descrição sobrando para estado que não existe", () => {
    expect(Object.keys(DESCRICOES).sort()).toEqual([...ESTADOS_CONEXAO].sort());
  });

  it("todo estado tem título e explicação preenchidos", () => {
    for (const estado of ESTADOS_CONEXAO) {
      const descricao = descrever(estado);
      expect(descricao.titulo.length, estado).toBeGreaterThan(0);
      expect(descricao.explicacao.length, estado).toBeGreaterThan(0);
    }
  });
});

describe("qualidade das mensagens", () => {
  it("todo estado que a pessoa precisa resolver diz o que fazer", () => {
    // Dizer que algo deu errado sem dizer o que fazer transfere o problema
    // para quem menos pode resolvê-lo.
    for (const estado of ESTADOS_CONEXAO) {
      if (!exigeAtencao(estado)) continue;
      expect(descrever(estado).acao, `${estado} precisa de ação`).toBeTruthy();
    }
  });

  it("nenhuma mensagem usa jargão técnico", () => {
    // Quem usa o SLATE quer controlar o computador, não depurar rede.
    const proibidos = [
      "socket",
      "WebRTC",
      "ICE",
      "handshake",
      "timeout",
      "token",
      "payload",
      "endpoint",
      "null",
      "undefined",
    ];

    for (const estado of ESTADOS_CONEXAO) {
      const texto = Object.values(descrever(estado)).join(" ").toLowerCase();
      for (const termo of proibidos) {
        expect(texto, `${estado} contém "${termo}"`).not.toContain(termo.toLowerCase());
      }
    }
  });

  it("nenhuma mensagem culpa o usuário", () => {
    for (const estado of ESTADOS_CONEXAO) {
      const texto = descrever(estado).explicacao.toLowerCase();
      expect(texto, estado).not.toMatch(/você (errou|esqueceu|não fez)/);
    }
  });
});

describe("operabilidade", () => {
  it("só o estado conectado permite operar", () => {
    // Aceitar toque sem conexão faria a pessoa tocar repetidamente, e os
    // comandos chegariam todos juntos quando a conexão voltasse.
    for (const estado of ESTADOS_CONEXAO) {
      expect(podeOperar(estado), estado).toBe(estado === "CONNECTED");
    }
  });

  it("estado conectado não fica tentando reconectar", () => {
    expect(estaTentando("CONNECTED")).toBe(false);
  });

  it("estados transitórios tentam resolver sozinhos", () => {
    for (const estado of ["CONNECTING", "RECONNECTING", "OFFLINE"] as const) {
      expect(estaTentando(estado), estado).toBe(true);
    }
  });

  it("estados que dependem da pessoa não insistem sozinhos", () => {
    // Insistir aqui seria tentar para sempre algo que nunca vai dar certo sem
    // uma ação humana.
    for (const estado of [
      "AUTH_REQUIRED",
      "PAIRING_REQUIRED",
      "VERSION_MISMATCH",
    ] as const) {
      expect(estaTentando(estado), estado).toBe(false);
      expect(exigeAtencao(estado), estado).toBe(true);
    }
  });

  it("um estado ou tenta sozinho ou pede ação, nunca os dois", () => {
    for (const estado of ESTADOS_CONEXAO) {
      const descricao = descrever(estado);
      expect(
        descricao.tentandoSozinho && exigeAtencao(estado),
        `${estado} não pode tentar sozinho e exigir atenção ao mesmo tempo`,
      ).toBe(false);
    }
  });
});
