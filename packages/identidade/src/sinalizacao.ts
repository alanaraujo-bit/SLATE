/**
 * Formas canônicas assinadas durante a sinalização.
 *
 * Delimitadores e ordem são parte do protocolo. Construir estas mensagens em
 * um único lugar evita assinar JSON, cuja serialização pode variar entre Rust
 * e JavaScript sem que o conteúdo aparente tenha mudado.
 */

export interface DadosDesafioSinalizacao {
  desafioId: string;
  dispositivoId: string;
  nonce: string;
  expiraEm: number;
}

export function mensagemDesafioSinalizacao(dados: DadosDesafioSinalizacao): string {
  return [
    "SLATE-SIGNAL-CHALLENGE/v1",
    dados.desafioId,
    dados.dispositivoId,
    dados.nonce,
    String(dados.expiraEm),
  ].join("\n");
}

export interface DadosConfirmacaoPareamento {
  codigo: string;
  chavePublicaAgente: string;
}

/**
 * Prova que a confirmação veio do Agente que possui a chave registrada.
 *
 * A conta autenticada não basta: sem esta assinatura, um cookie roubado
 * conseguiria confirmar um código e transformar acesso à conta em controle do
 * computador, contrariando o ADR-0004 §2.
 */
export function mensagemConfirmacaoPareamento(
  dados: DadosConfirmacaoPareamento,
): string {
  return [
    "SLATE-PAIR-CONFIRM/v1",
    dados.codigo.trim(),
    dados.chavePublicaAgente,
  ].join("\n");
}

export interface DadosCriacaoConviteQr {
  nonce: string;
  chavePublicaAgente: string;
}

/** Prova que o QR foi solicitado por um Agente registrado, não só pela conta. */
export function mensagemCriacaoConviteQr(dados: DadosCriacaoConviteQr): string {
  return [
    "SLATE-PAIR-QR-CREATE/v1",
    dados.nonce,
    dados.chavePublicaAgente,
  ].join("\n");
}

export interface DadosFingerprintDtls {
  sessaoId: string;
  dispositivoId: string;
  algoritmo: "sha-256";
  valor: string;
}

export function normalizarFingerprintDtls(valor: string): string {
  return valor.trim().toUpperCase();
}

export function mensagemFingerprintDtls(dados: DadosFingerprintDtls): string {
  return [
    "SLATE-DTLS-FINGERPRINT/v1",
    dados.sessaoId,
    dados.dispositivoId,
    dados.algoritmo,
    normalizarFingerprintDtls(dados.valor),
  ].join("\n");
}
