import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";
import type { Database } from "@slate/db";
import {
  convitesPareamentoQr,
  dispositivos,
  pedidosPareamento,
  sessoes,
  tentativasEntrada,
  usuarios,
} from "@slate/db/schema-contas";
import { hashDoToken, normalizarEmail } from "./sessao";

/**
 * Acesso a dados de conta.
 *
 * Fica separado das rotas para que as regras possam ser testadas contra um
 * banco real sem passar por HTTP — o que importa aqui são as consultas e as
 * restrições, não o roteamento.
 */

export interface ContextoSessao {
  usuarioId: string;
  email: string;
  nome: string | null;
  sessaoId: string;
}

export async function buscarUsuarioPorEmail(db: Database, email: string) {
  const [usuario] = await db
    .select()
    .from(usuarios)
    .where(eq(usuarios.email, normalizarEmail(email)))
    .limit(1);
  return usuario ?? null;
}

export async function criarUsuario(
  db: Database,
  dados: { email: string; senhaHash: string; nome?: string },
) {
  const [usuario] = await db
    .insert(usuarios)
    .values({
      email: normalizarEmail(dados.email),
      senhaHash: dados.senhaHash,
      nome: dados.nome ?? null,
    })
    .returning();
  return usuario!;
}

export async function atualizarHashSenha(
  db: Database,
  usuarioId: string,
  senhaHash: string,
) {
  await db
    .update(usuarios)
    .set({ senhaHash, atualizadoEm: new Date() })
    .where(eq(usuarios.id, usuarioId));
}

// ---------------------------------------------------------------------------
// Sessões
// ---------------------------------------------------------------------------

export async function criarSessao(
  db: Database,
  dados: {
    usuarioId: string;
    tokenHash: string;
    expiraEm: Date;
    agenteUsuario?: string | null;
  },
) {
  const [sessao] = await db
    .insert(sessoes)
    .values({
      usuarioId: dados.usuarioId,
      tokenHash: dados.tokenHash,
      expiraEm: dados.expiraEm,
      agenteUsuario: dados.agenteUsuario ?? null,
    })
    .returning();
  return sessao!;
}

/**
 * Resolve o token do cookie para o usuário.
 *
 * Sessão expirada é apagada em vez de apenas ignorada: sem isso a tabela cresce
 * para sempre, e a limpeza acaba virando um trabalho agendado que ninguém
 * lembra de criar.
 */
export async function resolverSessao(
  db: Database,
  token: string,
  agora: Date = new Date(),
): Promise<ContextoSessao | null> {
  const [linha] = await db
    .select({
      sessaoId: sessoes.id,
      expiraEm: sessoes.expiraEm,
      usuarioId: usuarios.id,
      email: usuarios.email,
      nome: usuarios.nome,
    })
    .from(sessoes)
    .innerJoin(usuarios, eq(sessoes.usuarioId, usuarios.id))
    .where(eq(sessoes.tokenHash, hashDoToken(token)))
    .limit(1);

  if (!linha) return null;

  if (agora.getTime() >= linha.expiraEm.getTime()) {
    await db.delete(sessoes).where(eq(sessoes.id, linha.sessaoId));
    return null;
  }

  return {
    usuarioId: linha.usuarioId,
    email: linha.email,
    nome: linha.nome,
    sessaoId: linha.sessaoId,
  };
}

export async function renovarSessao(
  db: Database,
  sessaoId: string,
  expiraEm: Date,
  agora: Date = new Date(),
) {
  await db
    .update(sessoes)
    .set({ expiraEm, ultimoUsoEm: agora })
    .where(eq(sessoes.id, sessaoId));
}

export async function encerrarSessao(db: Database, sessaoId: string) {
  await db.delete(sessoes).where(eq(sessoes.id, sessaoId));
}

/** Usado ao trocar a senha: quem sabia a senha antiga perde o acesso. */
export async function encerrarTodasAsSessoes(db: Database, usuarioId: string) {
  await db.delete(sessoes).where(eq(sessoes.usuarioId, usuarioId));
}

export async function limparSessoesExpiradas(db: Database, agora: Date = new Date()) {
  const removidas = await db
    .delete(sessoes)
    .where(lt(sessoes.expiraEm, agora))
    .returning({ id: sessoes.id });
  return removidas.length;
}

// ---------------------------------------------------------------------------
// Limite de tentativas
// ---------------------------------------------------------------------------

export const JANELA_TENTATIVAS_MS = 15 * 60 * 1000;
export const MAX_TENTATIVAS_JANELA = 10;

export async function registrarTentativa(db: Database, chave: string) {
  await db.insert(tentativasEntrada).values({ chave });
}

/**
 * Quantas tentativas houve na janela.
 *
 * A contagem é por chave, que pode ser a conta ou a origem. Contar só por conta
 * deixaria alguém varrer muitas contas com uma senha comum; contar só por
 * origem puniria uma rede inteira atrás do mesmo endereço.
 */
export async function contarTentativas(
  db: Database,
  chave: string,
  agora: Date = new Date(),
): Promise<number> {
  const desde = new Date(agora.getTime() - JANELA_TENTATIVAS_MS);

  const [linha] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(tentativasEntrada)
    .where(
      and(eq(tentativasEntrada.chave, chave), gte(tentativasEntrada.ocorridaEm, desde)),
    );

  return linha?.total ?? 0;
}

export async function limparTentativas(db: Database, chave: string) {
  await db.delete(tentativasEntrada).where(eq(tentativasEntrada.chave, chave));
}

// ---------------------------------------------------------------------------
// Dispositivos
// ---------------------------------------------------------------------------

export async function listarDispositivos(db: Database, usuarioId: string) {
  return db
    .select()
    .from(dispositivos)
    .where(eq(dispositivos.usuarioId, usuarioId));
}

export async function buscarDispositivoPorChave(db: Database, chavePublica: string) {
  const [dispositivo] = await db
    .select()
    .from(dispositivos)
    .where(eq(dispositivos.chavePublica, chavePublica))
    .limit(1);
  return dispositivo ?? null;
}

export async function buscarDispositivoDaConta(
  db: Database,
  usuarioId: string,
  dispositivoId: string,
) {
  const [dispositivo] = await db
    .select()
    .from(dispositivos)
    .where(
      and(
        eq(dispositivos.id, dispositivoId),
        eq(dispositivos.usuarioId, usuarioId),
        eq(dispositivos.situacao, "ativo"),
      ),
    )
    .limit(1);
  return dispositivo ?? null;
}

export async function criarDispositivo(
  db: Database,
  dados: {
    usuarioId: string;
    papel: "agent" | "surface";
    nome: string;
    chavePublica: string;
    algoritmo: string;
    escopos: string;
  },
) {
  const [dispositivo] = await db
    .insert(dispositivos)
    .values({ ...dados, situacao: "ativo" })
    .returning();
  return dispositivo!;
}

/**
 * Revoga um dispositivo.
 *
 * A linha não é apagada: manter o registro revogado é o que impede a mesma
 * chave de ser cadastrada de novo, já que o índice único continua valendo.
 */
export async function revogarDispositivo(
  db: Database,
  usuarioId: string,
  dispositivoId: string,
) {
  const revogados = await db
    .update(dispositivos)
    .set({ situacao: "revogado", revogadoEm: new Date() })
    .where(
      and(eq(dispositivos.id, dispositivoId), eq(dispositivos.usuarioId, usuarioId)),
    )
    .returning({ id: dispositivos.id });

  return revogados.length > 0;
}

// ---------------------------------------------------------------------------
// Pareamento
// ---------------------------------------------------------------------------

export async function criarPedidoPareamento(
  db: Database,
  dados: {
    usuarioId: string;
    codigoHash: string;
    chavePublicaSolicitante: string;
    algoritmo: string;
    nomeSolicitante: string;
    expiraEm: Date;
  },
) {
  const [pedido] = await db.insert(pedidosPareamento).values(dados).returning();
  return pedido!;
}

export async function buscarPedidoAtivo(
  db: Database,
  usuarioId: string,
  agora: Date = new Date(),
) {
  const [pedido] = await db
    .select()
    .from(pedidosPareamento)
    .where(
      and(
        eq(pedidosPareamento.usuarioId, usuarioId),
        isNull(pedidosPareamento.confirmadoEm),
        isNull(pedidosPareamento.bloqueadoEm),
        gte(pedidosPareamento.expiraEm, agora),
      ),
    )
    .limit(1);

  return pedido ?? null;
}

export async function registrarTentativaPareamento(db: Database, pedidoId: string) {
  const [pedido] = await db
    .update(pedidosPareamento)
    .set({ tentativas: sql`${pedidosPareamento.tentativas} + 1` })
    .where(eq(pedidosPareamento.id, pedidoId))
    .returning();
  return pedido!;
}

export async function bloquearPedido(db: Database, pedidoId: string) {
  await db
    .update(pedidosPareamento)
    .set({ bloqueadoEm: new Date() })
    .where(eq(pedidosPareamento.id, pedidoId));
}

export async function confirmarPedido(
  db: Database,
  pedidoId: string,
  agenteId: string,
) {
  await db
    .update(pedidosPareamento)
    .set({ confirmadoEm: new Date(), confirmadoPorDispositivoId: agenteId })
    .where(eq(pedidosPareamento.id, pedidoId));
}

export async function buscarResultadoPedidoPareamento(
  db: Database,
  usuarioId: string,
  pedidoId: string,
) {
  const [resultado] = await db
    .select({
      id: pedidosPareamento.id,
      expiraEm: pedidosPareamento.expiraEm,
      confirmadoEm: pedidosPareamento.confirmadoEm,
      bloqueadoEm: pedidosPareamento.bloqueadoEm,
      agenteId: dispositivos.id,
      agenteNome: dispositivos.nome,
      agentePapel: dispositivos.papel,
      agenteChavePublica: dispositivos.chavePublica,
      agenteAlgoritmo: dispositivos.algoritmo,
      agenteEscopos: dispositivos.escopos,
      agenteSituacao: dispositivos.situacao,
    })
    .from(pedidosPareamento)
    .leftJoin(
      dispositivos,
      eq(dispositivos.id, pedidosPareamento.confirmadoPorDispositivoId),
    )
    .where(
      and(
        eq(pedidosPareamento.id, pedidoId),
        eq(pedidosPareamento.usuarioId, usuarioId),
      ),
    )
    .limit(1);
  return resultado ?? null;
}

// ---------------------------------------------------------------------------
// Pareamento iniciado pelo QR exibido no Agente
// ---------------------------------------------------------------------------

export async function criarConvitePareamentoQr(
  db: Database,
  dados: {
    usuarioId: string;
    agenteId: string;
    tokenHash: string;
    expiraEm: Date;
  },
) {
  const [convite] = await db.insert(convitesPareamentoQr).values(dados).returning();
  return convite!;
}

export async function buscarConvitePareamentoQrPorToken(
  db: Database,
  usuarioId: string,
  tokenHash: string,
  agora: Date,
) {
  const [convite] = await db
    .select()
    .from(convitesPareamentoQr)
    .where(
      and(
        eq(convitesPareamentoQr.usuarioId, usuarioId),
        eq(convitesPareamentoQr.tokenHash, tokenHash),
        isNull(convitesPareamentoQr.aceitoEm),
        gte(convitesPareamentoQr.expiraEm, agora),
      ),
    )
    .limit(1);
  return convite ?? null;
}

export async function buscarConvitePareamentoQrPorId(
  db: Database,
  usuarioId: string,
  conviteId: string,
) {
  const [convite] = await db
    .select()
    .from(convitesPareamentoQr)
    .where(
      and(
        eq(convitesPareamentoQr.id, conviteId),
        eq(convitesPareamentoQr.usuarioId, usuarioId),
      ),
    )
    .limit(1);
  return convite ?? null;
}

export async function aceitarConvitePareamentoQr(
  db: Database,
  conviteId: string,
  superficieId: string,
  agora: Date,
) {
  const [convite] = await db
    .update(convitesPareamentoQr)
    .set({ superficieId, aceitoEm: agora })
    .where(
      and(
        eq(convitesPareamentoQr.id, conviteId),
        isNull(convitesPareamentoQr.aceitoEm),
        gte(convitesPareamentoQr.expiraEm, agora),
      ),
    )
    .returning();
  return convite ?? null;
}
