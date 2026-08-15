import { and, eq, gt, gte, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "@slate/db";
import {
  desafiosSinalizacao,
  dispositivos,
  tokensSinalizacao,
} from "@slate/db/schema-contas";

export interface DispositivoSinalizacao {
  id: string;
  usuarioId: string;
  papel: "agent" | "surface";
  chavePublica: string;
  algoritmo: string;
}

export async function buscarDispositivoAtivoPorChave(
  db: Database,
  chavePublica: string,
): Promise<DispositivoSinalizacao | null> {
  const [dispositivo] = await db
    .select({
      id: dispositivos.id,
      usuarioId: dispositivos.usuarioId,
      papel: dispositivos.papel,
      chavePublica: dispositivos.chavePublica,
      algoritmo: dispositivos.algoritmo,
    })
    .from(dispositivos)
    .where(
      and(eq(dispositivos.chavePublica, chavePublica), eq(dispositivos.situacao, "ativo")),
    )
    .limit(1);

  return dispositivo ?? null;
}

export async function contarDesafiosRecentes(
  db: Database,
  dispositivoId: string,
  desde: Date,
): Promise<number> {
  const [linha] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(desafiosSinalizacao)
    .where(
      and(
        eq(desafiosSinalizacao.dispositivoId, dispositivoId),
        gte(desafiosSinalizacao.criadoEm, desde),
      ),
    );
  return linha?.total ?? 0;
}

export async function criarDesafioSinalizacao(
  db: Database,
  dados: { dispositivoId: string; nonceHash: string; expiraEm: Date },
) {
  const [desafio] = await db.insert(desafiosSinalizacao).values(dados).returning();
  return desafio!;
}

export async function buscarDesafioAtivo(
  db: Database,
  desafioId: string,
  nonceHash: string,
  agora: Date,
) {
  const [resultado] = await db
    .select({
      id: desafiosSinalizacao.id,
      dispositivoId: dispositivos.id,
      usuarioId: dispositivos.usuarioId,
      papel: dispositivos.papel,
      chavePublica: dispositivos.chavePublica,
      algoritmo: dispositivos.algoritmo,
      expiraEm: desafiosSinalizacao.expiraEm,
    })
    .from(desafiosSinalizacao)
    .innerJoin(dispositivos, eq(dispositivos.id, desafiosSinalizacao.dispositivoId))
    .where(
      and(
        eq(desafiosSinalizacao.id, desafioId),
        eq(desafiosSinalizacao.nonceHash, nonceHash),
        isNull(desafiosSinalizacao.usadoEm),
        gt(desafiosSinalizacao.expiraEm, agora),
        eq(dispositivos.situacao, "ativo"),
      ),
    )
    .limit(1);

  return resultado ?? null;
}

/** Marca o desafio de forma atômica; duas respostas concorrentes não passam. */
export async function consumirDesafio(
  db: Database,
  desafioId: string,
  agora: Date,
): Promise<boolean> {
  const consumidos = await db
    .update(desafiosSinalizacao)
    .set({ usadoEm: agora })
    .where(
      and(
        eq(desafiosSinalizacao.id, desafioId),
        isNull(desafiosSinalizacao.usadoEm),
        gt(desafiosSinalizacao.expiraEm, agora),
      ),
    )
    .returning({ id: desafiosSinalizacao.id });

  return consumidos.length === 1;
}

export async function criarTokenSinalizacao(
  db: Database,
  dados: { dispositivoId: string; tokenHash: string; expiraEm: Date },
) {
  await db.insert(tokensSinalizacao).values(dados);
}

/** Consome o token e confirma de novo que o dispositivo ainda está ativo. */
export async function consumirTokenSinalizacao(
  db: Database,
  tokenHash: string,
  agora: Date,
): Promise<(DispositivoSinalizacao & { expiraEm: Date }) | null> {
  const [token] = await db
    .update(tokensSinalizacao)
    .set({ usadoEm: agora })
    .where(
      and(
        eq(tokensSinalizacao.tokenHash, tokenHash),
        isNull(tokensSinalizacao.usadoEm),
        gt(tokensSinalizacao.expiraEm, agora),
      ),
    )
    .returning({
      dispositivoId: tokensSinalizacao.dispositivoId,
      expiraEm: tokensSinalizacao.expiraEm,
    });

  if (!token) return null;

  const [dispositivo] = await db
    .select({
      id: dispositivos.id,
      usuarioId: dispositivos.usuarioId,
      papel: dispositivos.papel,
      chavePublica: dispositivos.chavePublica,
      algoritmo: dispositivos.algoritmo,
    })
    .from(dispositivos)
    .where(
      and(eq(dispositivos.id, token.dispositivoId), eq(dispositivos.situacao, "ativo")),
    )
    .limit(1);

  if (!dispositivo) return null;

  await db
    .update(dispositivos)
    .set({ ultimoAcessoEm: agora })
    .where(eq(dispositivos.id, dispositivo.id));

  return { ...dispositivo, expiraEm: token.expiraEm };
}

export async function dispositivoPodeAlcancar(
  db: Database,
  origem: DispositivoSinalizacao,
  destinoId: string,
): Promise<boolean> {
  const participantes = await db
    .select({ id: dispositivos.id, papel: dispositivos.papel })
    .from(dispositivos)
    .where(
      and(
        inArray(dispositivos.id, [origem.id, destinoId]),
        eq(dispositivos.usuarioId, origem.usuarioId),
        eq(dispositivos.situacao, "ativo"),
      ),
    );

  if (participantes.length !== 2) return false;
  const remetente = participantes.find((d) => d.id === origem.id);
  const destino = participantes.find((d) => d.id === destinoId);

  return Boolean(remetente && destino && destino.papel !== remetente.papel);
}

/**
 * IDs revogados são suficientes para sincronizar a lista local com segurança.
 * A nuvem nunca envia chaves novas por este caminho, portanto uma resposta
 * adulterada só consegue remover acesso (indisponibilidade), não concedê-lo.
 */
export async function listarDispositivosRevogados(
  db: Database,
  usuarioId: string,
): Promise<string[]> {
  const linhas = await db
    .select({ id: dispositivos.id })
    .from(dispositivos)
    .where(
      and(
        eq(dispositivos.usuarioId, usuarioId),
        eq(dispositivos.situacao, "revogado"),
      ),
    )
    .limit(5_000);
  return linhas.map((linha) => linha.id);
}

export async function dispositivoContinuaAtivo(
  db: Database,
  dispositivoId: string,
): Promise<boolean> {
  const [linha] = await db
    .select({ id: dispositivos.id })
    .from(dispositivos)
    .where(
      and(
        eq(dispositivos.id, dispositivoId),
        eq(dispositivos.situacao, "ativo"),
      ),
    )
    .limit(1);
  return Boolean(linha);
}
