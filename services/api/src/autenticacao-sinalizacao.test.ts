import { describe, expect, it, vi } from "vitest";
import type { Database } from "@slate/db";
import {
  assinar,
  gerarIdentidade,
  mensagemDesafioSinalizacao,
} from "@slate/identidade";
import {
  emitirDesafioSinalizacao,
  MAX_DESAFIOS_POR_MINUTO,
  trocarDesafioPorToken,
  VALIDADE_DESAFIO_SINALIZACAO_MS,
  VALIDADE_TOKEN_SINALIZACAO_MS,
  type RepositorioAutenticacaoSinalizacao,
} from "./autenticacao-sinalizacao";

const DB = {} as Database;
const AGORA = new Date("2026-08-15T12:00:00.000Z");
const DESAFIO_ID = "11111111-1111-4111-8111-111111111111";
const DISPOSITIVO_ID = "22222222-2222-4222-8222-222222222222";

function repositorio(
  sobrescritas: Partial<RepositorioAutenticacaoSinalizacao> = {},
): RepositorioAutenticacaoSinalizacao {
  return {
    buscarDispositivoAtivoPorChave: vi.fn(async () => null),
    contarDesafiosRecentes: vi.fn(async () => 0),
    criarDesafioSinalizacao: vi.fn(async (_db, dados) => ({
      id: DESAFIO_ID,
      nonceHash: dados.nonceHash,
      dispositivoId: dados.dispositivoId,
      expiraEm: dados.expiraEm,
      usadoEm: null,
      criadoEm: AGORA,
    })),
    buscarDesafioAtivo: vi.fn(async () => null),
    consumirDesafio: vi.fn(async () => true),
    criarTokenSinalizacao: vi.fn(async () => undefined),
    ...sobrescritas,
  };
}

describe("autenticação da sinalização", () => {
  it("não emite desafio para chave desconhecida ou revogada", async () => {
    const resultado = await emitirDesafioSinalizacao(
      DB,
      "chave-inexistente-com-tamanho-valido",
      AGORA,
      repositorio(),
    );
    expect(resultado).toEqual({ ok: false, erro: "dispositivo_invalido" });
  });

  it("limita desafios antes de gerar novo nonce", async () => {
    const repo = repositorio({
      buscarDispositivoAtivoPorChave: vi.fn(async () => ({
        id: DISPOSITIVO_ID,
        usuarioId: "conta",
        papel: "surface" as const,
        chavePublica: "chave",
        algoritmo: "Ed25519",
      })),
      contarDesafiosRecentes: vi.fn(async () => MAX_DESAFIOS_POR_MINUTO),
    });

    expect(await emitirDesafioSinalizacao(DB, "chave", AGORA, repo)).toEqual({
      ok: false,
      erro: "limite_excedido",
    });
    expect(repo.criarDesafioSinalizacao).not.toHaveBeenCalled();
  });

  it("emite nonce imprevisível com validade curta", async () => {
    const repo = repositorio({
      buscarDispositivoAtivoPorChave: vi.fn(async () => ({
        id: DISPOSITIVO_ID,
        usuarioId: "conta",
        papel: "surface" as const,
        chavePublica: "chave",
        algoritmo: "Ed25519",
      })),
    });
    const resultado = await emitirDesafioSinalizacao(DB, "chave", AGORA, repo);

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.nonce.length).toBeGreaterThanOrEqual(32);
    expect(resultado.expiraEm).toBe(AGORA.getTime() + VALIDADE_DESAFIO_SINALIZACAO_MS);
  });

  it("troca assinatura válida por token de cinco minutos e consome o desafio", async () => {
    const identidade = await gerarIdentidade();
    const expiraDesafio = new Date(AGORA.getTime() + VALIDADE_DESAFIO_SINALIZACAO_MS);
    const nonce = "n".repeat(43);
    const mensagem = mensagemDesafioSinalizacao({
      desafioId: DESAFIO_ID,
      dispositivoId: DISPOSITIVO_ID,
      nonce,
      expiraEm: expiraDesafio.getTime(),
    });
    const repo = repositorio({
      buscarDesafioAtivo: vi.fn(async () => ({
        id: DESAFIO_ID,
        dispositivoId: DISPOSITIVO_ID,
        usuarioId: "conta",
        papel: "surface" as const,
        chavePublica: identidade.chavePublicaExportada,
        algoritmo: identidade.algoritmo,
        expiraEm: expiraDesafio,
      })),
    });

    const resultado = await trocarDesafioPorToken(
      DB,
      { desafioId: DESAFIO_ID, nonce, assinatura: await assinar(identidade, mensagem) },
      AGORA,
      repo,
    );

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.token.length).toBeGreaterThanOrEqual(32);
    expect(resultado.expiraEm).toBe(AGORA.getTime() + VALIDADE_TOKEN_SINALIZACAO_MS);
    expect(repo.consumirDesafio).toHaveBeenCalledOnce();
    expect(repo.criarTokenSinalizacao).toHaveBeenCalledOnce();
  });

  it("assinatura inválida não consome o desafio nem emite token", async () => {
    const identidade = await gerarIdentidade();
    const repo = repositorio({
      buscarDesafioAtivo: vi.fn(async () => ({
        id: DESAFIO_ID,
        dispositivoId: DISPOSITIVO_ID,
        usuarioId: "conta",
        papel: "surface" as const,
        chavePublica: identidade.chavePublicaExportada,
        algoritmo: identidade.algoritmo,
        expiraEm: new Date(AGORA.getTime() + 60_000),
      })),
    });

    const resultado = await trocarDesafioPorToken(
      DB,
      { desafioId: DESAFIO_ID, nonce: "n".repeat(43), assinatura: "x".repeat(64) },
      AGORA,
      repo,
    );

    expect(resultado).toEqual({ ok: false, erro: "prova_invalida" });
    expect(repo.consumirDesafio).not.toHaveBeenCalled();
    expect(repo.criarTokenSinalizacao).not.toHaveBeenCalled();
  });
});
