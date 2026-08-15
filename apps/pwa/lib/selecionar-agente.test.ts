import { describe, expect, it } from "vitest";
import type { DispositivoResumo } from "./api";
import type { ParConfiavel } from "./identidade-local";
import { selecionarAgente } from "./selecionar-agente";

function par(id: string): ParConfiavel {
  return {
    id,
    nome: "PHANTOMX",
    papel: "agent",
    chavePublica: `chave-publica-${id}-com-tamanho-suficiente`,
    algoritmo: "Ed25519",
    escopos: [],
  };
}

function dispositivo(id: string, online: boolean, data: string): DispositivoResumo {
  return {
    ...par(id),
    papel: "agent",
    situacao: "ativo",
    criadoEm: data,
    ultimoAcessoEm: data,
    online,
  };
}

describe("seleção inteligente do Agente", () => {
  it("prefere a instalação realmente online mesmo com nomes duplicados", () => {
    const antigo = par("antigo");
    const atual = par("atual");
    expect(
      selecionarAgente(
        [antigo, atual],
        [
          dispositivo("antigo", false, "2026-08-15T20:00:00Z"),
          dispositivo("atual", true, "2026-08-15T19:00:00Z"),
        ],
      )?.par.id,
    ).toBe("atual");
  });

  it("sem presença, tenta a identidade acessada mais recentemente", () => {
    expect(
      selecionarAgente(
        [par("antigo"), par("recente")],
        [
          dispositivo("antigo", false, "2026-08-14T20:00:00Z"),
          dispositivo("recente", false, "2026-08-15T20:00:00Z"),
        ],
      )?.par.id,
    ).toBe("recente");
  });

  it("não confia numa chave da nuvem ausente na raiz local", () => {
    expect(selecionarAgente([], [dispositivo("desconhecido", true, "2026-08-15T20:00:00Z")])).toBeNull();
  });
});
