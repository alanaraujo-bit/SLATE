import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const derivar = promisify(scrypt) as (
  senha: string | Buffer,
  sal: Buffer,
  tamanho: number,
  opcoes: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Hash de senha com scrypt (ADR-0005).
 *
 * Nenhuma primitiva é inventada: scrypt e timingSafeEqual vêm do próprio Node.
 * O que este módulo faz é escolher parâmetros e cuidar do formato.
 */

/**
 * Parâmetros atuais.
 *
 * N=2^15 leva algo em torno de 100ms numa máquina comum — desconfortável para
 * quem tenta bilhões de combinações, imperceptível para quem está entrando na
 * conta. O custo de memória do scrypt é o que dificulta a vida de hardware
 * dedicado, e é por isso que ele é preferido a PBKDF2 aqui.
 */
export const PARAMETROS_ATUAIS = { N: 2 ** 15, r: 8, p: 1 } as const;

const TAMANHO_HASH = 64;
const TAMANHO_SAL = 16;

/** scrypt exige memória proporcional a N·r·128; sem folga, ele recusa e lança. */
const maxmem = (N: number, r: number) => 256 * N * r;

/**
 * Produz `scrypt$N$r$p$sal$hash`.
 *
 * Os parâmetros ficam gravados junto porque eles vão aumentar com o tempo.
 * Sem isso, subir o custo invalidaria todas as senhas já cadastradas — com
 * isso, senhas antigas continuam verificáveis e podem ser reforçadas na
 * próxima entrada da pessoa.
 */
export async function gerarHashSenha(
  senha: string,
  parametros = PARAMETROS_ATUAIS,
): Promise<string> {
  const { N, r, p } = parametros;
  const sal = randomBytes(TAMANHO_SAL);

  const hash = await derivar(senha.normalize("NFKC"), sal, TAMANHO_HASH, {
    N,
    r,
    p,
    maxmem: maxmem(N, r),
  });

  return ["scrypt", N, r, p, sal.toString("base64url"), hash.toString("base64url")].join(
    "$",
  );
}

export interface ResultadoVerificacao {
  confere: boolean;
  /** Verdadeiro quando o hash foi criado com parâmetros mais fracos que os atuais. */
  precisaAtualizar: boolean;
}

/**
 * Confere uma senha contra o hash guardado.
 *
 * Devolve `false` em vez de lançar para qualquer formato inesperado: um
 * caminho de exceção separado aqui viraria tratamento distinto no chamador, e
 * é assim que se abre a diferença observável entre "usuário não existe" e
 * "senha errada".
 */
export async function verificarSenha(
  senha: string,
  guardado: string,
): Promise<ResultadoVerificacao> {
  const negativo: ResultadoVerificacao = { confere: false, precisaAtualizar: false };

  const partes = guardado.split("$");
  if (partes.length !== 6 || partes[0] !== "scrypt") return negativo;

  const N = Number.parseInt(partes[1]!, 10);
  const r = Number.parseInt(partes[2]!, 10);
  const p = Number.parseInt(partes[3]!, 10);

  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return negativo;
  // Um hash com N absurdo travaria o processo ao ser verificado — o que
  // transformaria um registro corrompido numa negação de serviço.
  if (N < 2 ** 12 || N > 2 ** 20 || r < 1 || r > 32 || p < 1 || p > 16) return negativo;

  let salBytes: Buffer;
  let esperado: Buffer;
  try {
    salBytes = Buffer.from(partes[4]!, "base64url");
    esperado = Buffer.from(partes[5]!, "base64url");
  } catch {
    return negativo;
  }

  if (esperado.length !== TAMANHO_HASH || salBytes.length === 0) return negativo;

  try {
    const calculado = await derivar(senha.normalize("NFKC"), salBytes, TAMANHO_HASH, {
      N,
      r,
      p,
      maxmem: maxmem(N, r),
    });

    const confere = timingSafeEqual(calculado, esperado);

    return {
      confere,
      precisaAtualizar:
        confere &&
        (N < PARAMETROS_ATUAIS.N ||
          r < PARAMETROS_ATUAIS.r ||
          p < PARAMETROS_ATUAIS.p),
    };
  } catch {
    return negativo;
  }
}

/**
 * Consome tempo comparável ao de uma verificação real.
 *
 * Chamado quando o e-mail não existe. Sem isso, responder mais rápido para
 * e-mail inexistente entregaria quais endereços têm conta — que é exatamente o
 * que alguém precisa antes de tentar senhas.
 */
export async function gastarTempoEquivalente(): Promise<void> {
  const { N, r, p } = PARAMETROS_ATUAIS;
  await derivar("senha-descartavel", randomBytes(TAMANHO_SAL), TAMANHO_HASH, {
    N,
    r,
    p,
    maxmem: maxmem(N, r),
  });
}

/** Requisitos mínimos de senha, com a razão de cada um. */
export interface ProblemaSenha {
  codigo: "curta" | "longa" | "comum";
  mensagem: string;
}

/**
 * Lista das senhas mais usadas. Curta de propósito: o objetivo é barrar o
 * óbvio, e a defesa real contra adivinhação é o limite de tentativas.
 */
const SENHAS_COMUNS = new Set([
  "12345678",
  "123456789",
  "1234567890",
  "senha123",
  "password",
  "password1",
  "qwertyui",
  "11111111",
  "abc12345",
  "slate123",
]);

export function validarSenha(senha: string): ProblemaSenha[] {
  const problemas: ProblemaSenha[] = [];

  // Comprimento em pontos de código, e não em unidades UTF-16: senão um emoji
  // contaria como dois caracteres.
  const tamanho = [...senha].length;

  if (tamanho < 8) {
    problemas.push({
      codigo: "curta",
      mensagem: "A senha precisa ter pelo menos 8 caracteres.",
    });
  }

  // Limite superior porque scrypt processa a entrada inteira: uma senha de
  // megabytes viraria carga de processamento gratuita para o servidor.
  if (senha.length > 256) {
    problemas.push({
      codigo: "longa",
      mensagem: "A senha pode ter no máximo 256 caracteres.",
    });
  }

  if (SENHAS_COMUNS.has(senha.toLowerCase())) {
    problemas.push({
      codigo: "comum",
      mensagem: "Essa senha é muito comum. Escolha outra.",
    });
  }

  return problemas;
}
