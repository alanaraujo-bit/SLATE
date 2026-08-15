import { randomBytes } from "node:crypto";
import type { Database } from "@slate/db";
import { mensagemDesafioSinalizacao, verificar } from "@slate/identidade";
import { hashDoToken } from "./sessao";
import {
  buscarDesafioAtivo,
  buscarDispositivoAtivoPorChave,
  consumirDesafio,
  contarDesafiosRecentes,
  criarDesafioSinalizacao,
  criarTokenSinalizacao,
} from "./repositorio-sinalizacao";

export interface RepositorioAutenticacaoSinalizacao {
  buscarDispositivoAtivoPorChave: typeof buscarDispositivoAtivoPorChave;
  contarDesafiosRecentes: typeof contarDesafiosRecentes;
  criarDesafioSinalizacao: typeof criarDesafioSinalizacao;
  buscarDesafioAtivo: typeof buscarDesafioAtivo;
  consumirDesafio: typeof consumirDesafio;
  criarTokenSinalizacao: typeof criarTokenSinalizacao;
}

const REPOSITORIO_PADRAO: RepositorioAutenticacaoSinalizacao = {
  buscarDispositivoAtivoPorChave,
  contarDesafiosRecentes,
  criarDesafioSinalizacao,
  buscarDesafioAtivo,
  consumirDesafio,
  criarTokenSinalizacao,
};

export const VALIDADE_DESAFIO_SINALIZACAO_MS = 60_000;
export const VALIDADE_TOKEN_SINALIZACAO_MS = 5 * 60_000;
export const MAX_DESAFIOS_POR_MINUTO = 5;

export type ErroAutenticacaoSinalizacao =
  | "dispositivo_invalido"
  | "limite_excedido"
  | "prova_invalida";

export type ResultadoDesafio =
  | {
      ok: true;
      desafioId: string;
      dispositivoId: string;
      nonce: string;
      expiraEm: number;
    }
  | { ok: false; erro: ErroAutenticacaoSinalizacao };

export type ResultadoToken =
  | { ok: true; token: string; expiraEm: number }
  | { ok: false; erro: ErroAutenticacaoSinalizacao };

export async function emitirDesafioSinalizacao(
  db: Database,
  chavePublica: string,
  agora: Date = new Date(),
  repositorio: RepositorioAutenticacaoSinalizacao = REPOSITORIO_PADRAO,
): Promise<ResultadoDesafio> {
  const dispositivo = await repositorio.buscarDispositivoAtivoPorChave(db, chavePublica);
  if (!dispositivo) return { ok: false, erro: "dispositivo_invalido" };

  const desde = new Date(agora.getTime() - 60_000);
  if (
    (await repositorio.contarDesafiosRecentes(db, dispositivo.id, desde)) >=
    MAX_DESAFIOS_POR_MINUTO
  ) {
    return { ok: false, erro: "limite_excedido" };
  }

  const nonce = randomBytes(32).toString("base64url");
  const expiraEm = new Date(agora.getTime() + VALIDADE_DESAFIO_SINALIZACAO_MS);
  const desafio = await repositorio.criarDesafioSinalizacao(db, {
    dispositivoId: dispositivo.id,
    nonceHash: hashDoToken(nonce),
    expiraEm,
  });

  return {
    ok: true,
    desafioId: desafio.id,
    dispositivoId: dispositivo.id,
    nonce,
    expiraEm: expiraEm.getTime(),
  };
}

export async function trocarDesafioPorToken(
  db: Database,
  prova: { desafioId: string; nonce: string; assinatura: string },
  agora: Date = new Date(),
  repositorio: RepositorioAutenticacaoSinalizacao = REPOSITORIO_PADRAO,
): Promise<ResultadoToken> {
  const desafio = await repositorio.buscarDesafioAtivo(
    db,
    prova.desafioId,
    hashDoToken(prova.nonce),
    agora,
  );
  if (!desafio) return { ok: false, erro: "prova_invalida" };

  const mensagem = mensagemDesafioSinalizacao({
    desafioId: desafio.id,
    dispositivoId: desafio.dispositivoId,
    nonce: prova.nonce,
    expiraEm: desafio.expiraEm.getTime(),
  });

  const assinaturaValida = await verificar(
    desafio.chavePublica,
    desafio.algoritmo,
    mensagem,
    prova.assinatura,
  );
  if (!assinaturaValida) return { ok: false, erro: "prova_invalida" };

  // Só uma resposta concorrente pode trocar o desafio por token.
  if (!(await repositorio.consumirDesafio(db, desafio.id, agora))) {
    return { ok: false, erro: "prova_invalida" };
  }

  const token = randomBytes(32).toString("base64url");
  const expiraEm = new Date(agora.getTime() + VALIDADE_TOKEN_SINALIZACAO_MS);
  await repositorio.criarTokenSinalizacao(db, {
    dispositivoId: desafio.dispositivoId,
    tokenHash: hashDoToken(token),
    expiraEm,
  });

  return { ok: true, token, expiraEm: expiraEm.getTime() };
}
