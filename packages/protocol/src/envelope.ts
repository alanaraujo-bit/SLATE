import { z } from "zod";

/**
 * O envelope do protocolo SLATE.
 *
 * Ver ADR-0003. A forma externa é a mesma para qualquer transporte, o que é o
 * que mantém barata a troca de DataChannel por WebSocket retransmitido caso o
 * WebRTC se mostre inviável em algum navegador.
 */

/**
 * Versão maior do protocolo.
 *
 * Só muda quando o *envelope* muda de forma incompatível — o que deve ser raro.
 * Evolução de funcionalidade passa por capacidades, nunca por este número.
 */
export const VERSAO_PROTOCOLO = 1;

/** Janela de tolerância para o timestamp, em milissegundos (ADR-0004 §6). */
export const JANELA_TIMESTAMP_MS = 30_000;

export const tipoMensagem = z.enum(["req", "res", "evt"]);
export type TipoMensagem = z.infer<typeof tipoMensagem>;

/**
 * Cabeçalho comum. O conteúdo (`p`) é validado por tipo, separadamente, porque
 * cada tipo de mensagem tem seu próprio schema.
 */
export const envelopeBase = z.object({
  v: z.number().int().positive(),
  id: z.string().min(1).max(64),
  t: tipoMensagem,
  k: z.string().min(1).max(64),
  ts: z.number().int().nonnegative(),
  seq: z.number().int().nonnegative(),
  p: z.unknown(),
});

export type Envelope = z.infer<typeof envelopeBase>;

export interface EnvelopeDe<T> extends Envelope {
  p: T;
}

/** Motivos pelos quais um envelope é recusado antes de qualquer processamento. */
export type MotivoRecusa =
  | "malformado"
  | "versao_incompativel"
  | "timestamp_fora_da_janela"
  | "sequencia_repetida"
  | "tipo_desconhecido"
  | "conteudo_invalido";

export interface ResultadoValidacao<T> {
  ok: boolean;
  valor?: T;
  motivo?: MotivoRecusa;
  detalhe?: string;
}

/**
 * Estado por sessão necessário para detectar repetição.
 *
 * Vive por sessão e não globalmente: o contador reinicia a cada conexão, e
 * misturar sessões faria uma reconexão legítima parecer ataque.
 */
export interface EstadoSessao {
  ultimaSequencia: number;
}

export function novoEstadoSessao(): EstadoSessao {
  return { ultimaSequencia: -1 };
}

/**
 * Valida um envelope recebido.
 *
 * Rejeita antes de olhar o conteúdo, e nunca processa nada parcialmente. Vale
 * nas duas direções: o Agente não confia na PWA e a PWA não confia no Agente.
 *
 * `agora` é injetável para que os testes não dependam do relógio real.
 */
export function validarEnvelope(
  bruto: unknown,
  sessao: EstadoSessao,
  agora: number = Date.now(),
): ResultadoValidacao<Envelope> {
  const analise = envelopeBase.safeParse(bruto);
  if (!analise.success) {
    return { ok: false, motivo: "malformado", detalhe: analise.error.message };
  }

  const envelope = analise.data;

  if (envelope.v !== VERSAO_PROTOCOLO) {
    return {
      ok: false,
      motivo: "versao_incompativel",
      detalhe: `esperado v${VERSAO_PROTOCOLO}, recebido v${envelope.v}`,
    };
  }

  // Fora da janela em qualquer direção: no futuro também é suspeito, porque
  // permitiria guardar uma mensagem para reenviar mais tarde.
  if (Math.abs(agora - envelope.ts) > JANELA_TIMESTAMP_MS) {
    return {
      ok: false,
      motivo: "timestamp_fora_da_janela",
      detalhe: `diferença de ${Math.abs(agora - envelope.ts)}ms`,
    };
  }

  // Respostas correlacionam por `id` e podem chegar fora de ordem; exigir
  // sequência crescente nelas recusaria tráfego legítimo.
  if (envelope.t !== "res" && envelope.seq <= sessao.ultimaSequencia) {
    return {
      ok: false,
      motivo: "sequencia_repetida",
      detalhe: `seq ${envelope.seq} <= ${sessao.ultimaSequencia}`,
    };
  }

  if (envelope.t !== "res") {
    sessao.ultimaSequencia = envelope.seq;
  }

  return { ok: true, valor: envelope };
}

let contadorSequencia = 0;

/** Zera o contador de saída. Usado ao abrir uma sessão nova. */
export function reiniciarSequencia(): void {
  contadorSequencia = 0;
}

export function criarEnvelope<T>(
  tipo: TipoMensagem,
  kind: string,
  conteudo: T,
  opcoes: { id?: string; agora?: number } = {},
): EnvelopeDe<T> {
  return {
    v: VERSAO_PROTOCOLO,
    id: opcoes.id ?? gerarId(),
    t: tipo,
    k: kind,
    ts: opcoes.agora ?? Date.now(),
    seq: contadorSequencia++,
    p: conteudo,
  };
}

function gerarId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  // Ambientes sem WebCrypto: o id só precisa ser único na sessão, não secreto.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
