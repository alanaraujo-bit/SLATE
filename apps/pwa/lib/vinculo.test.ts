import { describe, expect, it } from "vitest";
import type { DispositivoResumo } from "./api";
import type { ParConfiavel } from "./identidade-local";
import { decidirVinculo } from "./vinculo";

const CHAVE_SUPERFICIE = "chave-publica-desta-superficie-com-tamanho";

function dispositivo(
  id: string,
  papel: "agent" | "surface",
  extra: Partial<DispositivoResumo> = {},
): DispositivoResumo {
  return {
    id,
    nome: papel === "agent" ? "PHANTOMX" : "Celular",
    papel,
    situacao: "ativo",
    chavePublica: papel === "surface" ? CHAVE_SUPERFICIE : `chave-publica-${id}-longa`,
    algoritmo: "Ed25519",
    escopos: [],
    criadoEm: "2026-08-15T20:00:00Z",
    ultimoAcessoEm: "2026-08-15T20:00:00Z",
    online: false,
    ...extra,
  };
}

function par(id: string): ParConfiavel {
  return {
    id,
    nome: "PHANTOMX",
    papel: "agent",
    chavePublica: `chave-publica-${id}-longa`,
    algoritmo: "Ed25519",
    escopos: [],
  };
}

describe("por que este aparelho não está controlando um computador", () => {
  it("pede pareamento quando este celular não é superfície ativa da conta", () => {
    expect(decidirVinculo(CHAVE_SUPERFICIE, [], []).tipo).toBe("sem-superficie");
  });

  it("distingue conta sem nenhum computador de computador desconhecido", () => {
    const so_celular = [dispositivo("s1", "surface")];
    expect(decidirVinculo(CHAVE_SUPERFICIE, [], so_celular).tipo).toBe("sem-computador");
  });

  it("não fica esperando por um computador que este aparelho nunca confirmou", () => {
    // O caso da reinstalação: a nuvem lista um Agente novo, o celular só
    // confia no antigo. Tratar isso como "aguardando conexão" é esperar para
    // sempre.
    const vinculo = decidirVinculo(CHAVE_SUPERFICIE, [par("antigo")], [
      dispositivo("s1", "surface"),
      dispositivo("novo", "agent", { online: true }),
    ]);
    expect(vinculo).toEqual({
      tipo: "computador-desconhecido",
      nome: "PHANTOMX",
      online: true,
    });
  });

  it("conecta quando o par confiável está de fato na conta", () => {
    const vinculo = decidirVinculo(CHAVE_SUPERFICIE, [par("meu")], [
      dispositivo("s1", "surface"),
      dispositivo("meu", "agent", { online: true }),
    ]);
    expect(vinculo.tipo).toBe("pronto");
    if (vinculo.tipo === "pronto") expect(vinculo.agente.par.id).toBe("meu");
  });

  it("um computador confiável desligado continua sendo o par — não vira pareamento", () => {
    const vinculo = decidirVinculo(CHAVE_SUPERFICIE, [par("meu")], [
      dispositivo("s1", "surface"),
      dispositivo("meu", "agent", { online: false }),
    ]);
    expect(vinculo.tipo).toBe("pronto");
  });

  it("uma superfície revogada volta a exigir pareamento", () => {
    const vinculo = decidirVinculo(CHAVE_SUPERFICIE, [par("meu")], [
      dispositivo("s1", "surface", { situacao: "revogado" }),
      dispositivo("meu", "agent", { online: true }),
    ]);
    expect(vinculo.tipo).toBe("sem-superficie");
  });
});
