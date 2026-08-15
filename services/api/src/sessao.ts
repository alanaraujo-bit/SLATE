import { createHash, randomBytes } from "node:crypto";

/**
 * Sessões opacas (ADR-0005).
 *
 * O cookie carrega um valor aleatório sem significado. O banco guarda apenas o
 * hash dele. Não há nada para decodificar, nada para assinar e nenhuma chave de
 * assinatura para rotacionar — as três coisas que costumam dar errado em
 * sessão baseada em token autocontido.
 */

export const NOME_COOKIE = "slate_sessao";

/** Superfície de controle é ferramenta de uso diário; sessão curta irrita sem proteger. */
export const VALIDADE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * A partir de quanto uso a validade é estendida.
 *
 * Estender a cada requisição faria uma escrita no banco por requisição. Um dia
 * de folga dá o mesmo efeito prático para a pessoa, com uma fração da escrita.
 */
export const RENOVAR_APOS_MS = 24 * 60 * 60 * 1000;

/** 256 bits: não é adivinhável, e o custo de gerar é irrelevante. */
const TAMANHO_TOKEN = 32;

export interface TokenSessao {
  /** Vai para o cookie. Existe apenas neste instante — nunca é guardado. */
  token: string;
  /** Vai para o banco. */
  hash: string;
  expiraEm: Date;
}

export function criarTokenSessao(agora: Date = new Date()): TokenSessao {
  const token = randomBytes(TAMANHO_TOKEN).toString("base64url");
  return {
    token,
    hash: hashDoToken(token),
    expiraEm: new Date(agora.getTime() + VALIDADE_MS),
  };
}

/**
 * SHA-256 simples, sem sal e sem alongamento — de propósito.
 *
 * Alongar faz sentido contra segredo adivinhável, que é o caso de senha. Um
 * token de 256 bits aleatórios não é adivinhável, então o custo de scrypt aqui
 * só tornaria cada requisição mais lenta sem acrescentar defesa.
 */
export function hashDoToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

export function sessaoExpirada(expiraEm: Date, agora: Date = new Date()): boolean {
  return agora.getTime() >= expiraEm.getTime();
}

export function precisaRenovar(ultimoUsoEm: Date, agora: Date = new Date()): boolean {
  return agora.getTime() - ultimoUsoEm.getTime() >= RENOVAR_APOS_MS;
}

export interface OpcoesCookie {
  /** Falso apenas em desenvolvimento local sobre http. */
  seguro: boolean;
  dominio?: string;
}

/**
 * Monta o cabeçalho Set-Cookie.
 *
 * `HttpOnly` é o que impede um script injetado de ler a sessão. `SameSite=Lax`
 * e não `Strict` porque Strict quebraria o caso de abrir o SLATE a partir de um
 * link — a pessoa chegaria deslogada sem entender por quê — e Lax já barra o
 * envio em requisições de outros sites, que é o ataque que importa aqui.
 */
export function montarCookie(
  token: string,
  expiraEm: Date,
  opcoes: OpcoesCookie,
): string {
  const partes = [
    `${NOME_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${expiraEm.toUTCString()}`,
    `Max-Age=${Math.floor((expiraEm.getTime() - Date.now()) / 1000)}`,
  ];

  if (opcoes.seguro) partes.push("Secure");
  if (opcoes.dominio) partes.push(`Domain=${opcoes.dominio}`);

  return partes.join("; ");
}

/**
 * Cookie que apaga a sessão.
 *
 * Precisa repetir Path, SameSite e Secure do original: o navegador só
 * sobrescreve um cookie quando esses atributos batem, e um logout que não
 * apaga o cookie deixa a pessoa achando que saiu.
 */
export function montarCookieDeSaida(opcoes: OpcoesCookie): string {
  const partes = [
    `${NOME_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "Max-Age=0",
  ];

  if (opcoes.seguro) partes.push("Secure");
  if (opcoes.dominio) partes.push(`Domain=${opcoes.dominio}`);

  return partes.join("; ");
}

/** Lê o token do cabeçalho Cookie. */
export function lerCookieSessao(cabecalho: string | null | undefined): string | null {
  if (!cabecalho) return null;

  for (const parte of cabecalho.split(";")) {
    const separador = parte.indexOf("=");
    if (separador === -1) continue;

    const nome = parte.slice(0, separador).trim();
    if (nome !== NOME_COOKIE) continue;

    const valor = parte.slice(separador + 1).trim();
    return valor.length > 0 ? valor : null;
  }

  return null;
}

/**
 * Normaliza e-mail para comparação.
 *
 * Só minúsculas e espaços em volta. Deliberadamente **não** remove pontos nem
 * trata `+etiqueta`: essas regras são específicas de alguns provedores, e
 * aplicá-las a todos faria endereços legítimos e distintos colidirem numa
 * mesma conta.
 */
export function normalizarEmail(email: string): string {
  return email.trim().toLowerCase();
}

const FORMATO_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function emailValido(email: string): boolean {
  const normalizado = normalizarEmail(email);
  return normalizado.length <= 254 && FORMATO_EMAIL.test(normalizado);
}
