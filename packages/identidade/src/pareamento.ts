/**
 * Pareamento com posse física do PC (ADR-0004 §2).
 *
 * A regra que este módulo existe para sustentar: autenticar na conta não
 * basta. Se bastasse, uma senha vazada viraria execução remota de comandos na
 * máquina de alguém — que é a diferença entre um incidente chato e um
 * incidente grave.
 *
 * O código de seis dígitos não é segredo criptográfico e não protege nada
 * sozinho. Ele prova uma coisa só: quem está pedindo o pareamento está na
 * frente do computador. A segurança vem das chaves; o código amarra a troca de
 * chaves à presença física.
 */

/** Curto porque alguém vai digitar isso olhando para outra tela. */
export const TAMANHO_CODIGO = 6;

/** Tempo suficiente para pegar o celular; curto o bastante para não ficar largado. */
export const VALIDADE_MS = 2 * 60 * 1000;

/** Erro de digitação acontece; força bruta, não. */
export const MAX_TENTATIVAS = 3;

export interface PedidoPareamento {
  id: string;
  codigo: string;
  /** Chave pública de quem está pedindo, para o PC saber o que está autorizando. */
  chavePublicaSolicitante: string;
  algoritmo: string;
  criadoEm: number;
  expiraEm: number;
  tentativas: number;
  situacao: "pendente" | "confirmado" | "expirado" | "bloqueado";
}

export type ResultadoVerificacao =
  | { ok: true; pedido: PedidoPareamento }
  | {
      ok: false;
      motivo: "codigo_incorreto" | "expirado" | "bloqueado" | "ja_usado";
      tentativasRestantes: number;
    };

/**
 * Gera um código decimal de seis dígitos com gerador criptográfico.
 *
 * `Math.random()` não serve: é previsível o suficiente para que alguém que
 * observe alguns códigos consiga antecipar os próximos, e o valor todo do
 * código está em não ser adivinhável durante os dois minutos de vida.
 *
 * O laço de rejeição existe para não enviesar a distribuição — pegar o resto
 * de um número aleatório de 32 bits por 10^6 deixaria os primeiros valores
 * ligeiramente mais prováveis.
 */
export function gerarCodigo(): string {
  const limite = 10 ** TAMANHO_CODIGO;
  const maiorMultiplo = Math.floor(0xffffffff / limite) * limite;

  const buffer = new Uint32Array(1);
  let valor: number;

  do {
    crypto.getRandomValues(buffer);
    valor = buffer[0]!;
  } while (valor >= maiorMultiplo);

  return String(valor % limite).padStart(TAMANHO_CODIGO, "0");
}

export function criarPedido(entrada: {
  id: string;
  chavePublicaSolicitante: string;
  algoritmo: string;
  agora?: number;
}): PedidoPareamento {
  const agora = entrada.agora ?? Date.now();

  return {
    id: entrada.id,
    codigo: gerarCodigo(),
    chavePublicaSolicitante: entrada.chavePublicaSolicitante,
    algoritmo: entrada.algoritmo,
    criadoEm: agora,
    expiraEm: agora + VALIDADE_MS,
    tentativas: 0,
    situacao: "pendente",
  };
}

/**
 * Comparação em tempo constante.
 *
 * Comparar com `===` sai no primeiro caractere diferente, e essa diferença de
 * tempo é mensurável pela rede. Com ela, um atacante descobre o código dígito
 * a dígito — seis tentativas por posição em vez de um milhão no total, o que
 * transforma um espaço razoável num espaço trivial.
 */
export function comparacaoSegura(a: string, b: string): boolean {
  // Compara sempre o mesmo número de posições, mesmo com tamanhos diferentes,
  // para o próprio tamanho não vazar pelo tempo.
  const tamanho = Math.max(a.length, b.length);
  let diferenca = a.length ^ b.length;

  for (let i = 0; i < tamanho; i++) {
    diferenca |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }

  return diferenca === 0;
}

/**
 * Confere o código digitado no PC.
 *
 * A ordem das checagens importa: expiração e bloqueio vêm antes da comparação,
 * para que um pedido morto não consuma tentativa nem revele nada sobre o
 * código.
 */
export function verificarCodigo(
  pedido: PedidoPareamento,
  digitado: string,
  agora: number = Date.now(),
): ResultadoVerificacao {
  if (pedido.situacao === "confirmado") {
    return { ok: false, motivo: "ja_usado", tentativasRestantes: 0 };
  }

  if (pedido.situacao === "bloqueado") {
    return { ok: false, motivo: "bloqueado", tentativasRestantes: 0 };
  }

  if (agora >= pedido.expiraEm) {
    pedido.situacao = "expirado";
    return { ok: false, motivo: "expirado", tentativasRestantes: 0 };
  }

  if (pedido.situacao === "expirado") {
    return { ok: false, motivo: "expirado", tentativasRestantes: 0 };
  }

  pedido.tentativas += 1;

  if (!comparacaoSegura(pedido.codigo, digitado.trim())) {
    const restantes = MAX_TENTATIVAS - pedido.tentativas;

    // Esgotadas as tentativas, o pedido inteiro morre — e não apenas a
    // tentativa. Recomeçar exige um código novo, o que devolve o espaço de
    // busca ao tamanho original.
    if (restantes <= 0) {
      pedido.situacao = "bloqueado";
      return { ok: false, motivo: "bloqueado", tentativasRestantes: 0 };
    }

    return { ok: false, motivo: "codigo_incorreto", tentativasRestantes: restantes };
  }

  pedido.situacao = "confirmado";
  return { ok: true, pedido };
}

/** Se o pedido ainda pode ser confirmado. */
export function pedidoAtivo(
  pedido: PedidoPareamento,
  agora: number = Date.now(),
): boolean {
  return pedido.situacao === "pendente" && agora < pedido.expiraEm;
}

/** Segundos restantes, para a contagem regressiva na tela. */
export function segundosRestantes(
  pedido: PedidoPareamento,
  agora: number = Date.now(),
): number {
  return Math.max(0, Math.ceil((pedido.expiraEm - agora) / 1000));
}

/** Formata como "123 456" — dois grupos são mais fáceis de ler e digitar. */
export function formatarCodigo(codigo: string): string {
  return `${codigo.slice(0, 3)} ${codigo.slice(3)}`;
}
