import { z } from "zod";

/** Contratos do plano de controle. O conteúdo do DataChannel não passa aqui. */

const id = z.string().uuid();
const sdp = z.string().min(1).max(131_072);

export const servidorIce = z.object({
  urls: z
    .array(z.string().min(1).max(512).regex(/^(stun|stuns|turn|turns):/))
    .min(1)
    .max(16),
  username: z.string().max(1_024).optional(),
  credential: z.string().max(1_024).optional(),
}).strict();

export type ServidorIce = z.infer<typeof servidorIce>;

export const pedidoDesafioSinalizacao = z.object({
  chavePublica: z.string().min(20).max(2_048),
}).strict();

export const provaDesafioSinalizacao = z.object({
  desafioId: id,
  nonce: z.string().min(32).max(256),
  assinatura: z.string().min(32).max(256),
}).strict();

export const fingerprintDtls = z.object({
  algoritmo: z.literal("sha-256"),
  valor: z.string().regex(/^([0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2}$/),
  assinatura: z.string().min(32).max(256),
}).strict();

export const candidatoIce = z.object({
  candidate: z.string().min(1).max(2_048),
  sdpMid: z.string().max(128).nullable().optional(),
  sdpMLineIndex: z.number().int().min(0).max(65_535).nullable().optional(),
  usernameFragment: z.string().max(256).nullable().optional(),
  /** Extensão do webrtc-rs para indicar a origem de candidato STUN/TURN. */
  url: z.string().min(1).max(512).regex(/^(stun|stuns|turn|turns):/).optional(),
}).strict();

export const mensagemClienteSinalizacao = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("autenticar"), token: z.string().min(32).max(256) }).strict(),
  z.object({
    tipo: z.literal("oferta"),
    destino: id,
    sessaoId: id,
    sdp,
    fingerprint: fingerprintDtls,
  }).strict(),
  z.object({
    tipo: z.literal("resposta"),
    destino: id,
    sessaoId: id,
    sdp,
    fingerprint: fingerprintDtls,
  }).strict(),
  z.object({
    tipo: z.literal("candidato"),
    destino: id,
    sessaoId: id,
    candidato: candidatoIce,
  }).strict(),
  z.object({ tipo: z.literal("encerrar"), destino: id, sessaoId: id }).strict(),
]);

export type MensagemClienteSinalizacao = z.infer<typeof mensagemClienteSinalizacao>;

export const mensagemServidorSinalizacao = z.discriminatedUnion("tipo", [
  z.object({
    tipo: z.literal("pronto"),
    dispositivoId: id,
    papel: z.enum(["agent", "surface"]),
    expiraEm: z.number().int().positive(),
    servidoresIce: z.array(servidorIce).max(8),
    iceExpiraEm: z.number().int().positive().nullable(),
  }).strict(),
  z.object({
    tipo: z.literal("oferta"),
    origem: id,
    sessaoId: id,
    sdp,
    fingerprint: fingerprintDtls,
  }).strict(),
  z.object({
    tipo: z.literal("resposta"),
    origem: id,
    sessaoId: id,
    sdp,
    fingerprint: fingerprintDtls,
  }).strict(),
  z.object({
    tipo: z.literal("candidato"),
    origem: id,
    sessaoId: id,
    candidato: candidatoIce,
  }).strict(),
  z.object({ tipo: z.literal("encerrar"), origem: id, sessaoId: id }).strict(),
  z.object({
    tipo: z.literal("revogacoes"),
    dispositivoIds: z.array(id).max(5_000),
  }).strict(),
  z.object({
    tipo: z.literal("configuracao-ice"),
    servidoresIce: z.array(servidorIce).max(8),
    iceExpiraEm: z.number().int().positive().nullable(),
  }).strict(),
  z.object({
    tipo: z.literal("indisponivel"),
    dispositivoId: id,
    sessaoId: id.optional(),
  }).strict(),
  z.object({
    tipo: z.literal("erro"),
    codigo: z.enum([
      "nao_autenticado",
      "mensagem_invalida",
      "destino_invalido",
      "limite_excedido",
    ]),
  }).strict(),
]);

export type MensagemServidorSinalizacao = z.infer<typeof mensagemServidorSinalizacao>;
