import {
  PARAMETROS,
  ehAlgoritmoConhecido,
  melhorAlgoritmoDisponivel,
  type Algoritmo,
} from "./algoritmos";

/**
 * Identidade criptográfica de dispositivo (ADR-0004 §1).
 *
 * Escrito só com a Web Crypto API, sem biblioteca de terceiros e sem
 * `node:crypto`. O mesmo código roda no navegador da PWA e no Node do serviço,
 * o que elimina a possibilidade de as duas pontas divergirem em detalhes de
 * formato — que é onde erros de assinatura costumam se esconder.
 */

export interface IdentidadeDispositivo {
  algoritmo: Algoritmo;
  /** Fica em memória; no navegador é criada como não-extraível. */
  chavePrivada: CryptoKey;
  chavePublica: CryptoKey;
  /** Chave pública em SPKI + base64url. É o identificador público. */
  chavePublicaExportada: string;
}

/**
 * Gera uma identidade nova.
 *
 * `extraivel` é falso por padrão de propósito. No navegador isso impede que a
 * chave privada seja lida por qualquer script, inclusive um injetado por XSS —
 * o que não impede *usá-la* enquanto a página está aberta, limitação declarada
 * no ADR-0004 e coberta pelos escopos.
 */
export async function gerarIdentidade(
  opcoes: { algoritmo?: Algoritmo; extraivel?: boolean } = {},
): Promise<IdentidadeDispositivo> {
  const algoritmo = opcoes.algoritmo ?? (await melhorAlgoritmoDisponivel());
  const extraivel = opcoes.extraivel ?? false;

  const par = (await crypto.subtle.generateKey(
    PARAMETROS[algoritmo].geracao as EcKeyGenParams,
    extraivel,
    ["sign", "verify"],
  )) as CryptoKeyPair;

  return {
    algoritmo,
    chavePrivada: par.privateKey,
    chavePublica: par.publicKey,
    chavePublicaExportada: await exportarChavePublica(par.publicKey),
  };
}

export async function exportarChavePublica(chave: CryptoKey): Promise<string> {
  const bruta = await crypto.subtle.exportKey("spki", chave);
  return paraBase64Url(new Uint8Array(bruta));
}

export async function importarChavePublica(
  exportada: string,
  algoritmo: Algoritmo,
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "spki",
    deBase64Url(exportada) as BufferSource,
    PARAMETROS[algoritmo].importacao as EcKeyImportParams,
    true,
    ["verify"],
  );
}

export async function assinar(
  identidade: Pick<IdentidadeDispositivo, "algoritmo" | "chavePrivada">,
  mensagem: string | Uint8Array,
): Promise<string> {
  const dados = typeof mensagem === "string" ? new TextEncoder().encode(mensagem) : mensagem;

  const assinatura = await crypto.subtle.sign(
    PARAMETROS[identidade.algoritmo].assinatura as EcdsaParams,
    identidade.chavePrivada,
    dados as BufferSource,
  );

  return paraBase64Url(new Uint8Array(assinatura));
}

/**
 * Verifica uma assinatura.
 *
 * Devolve `false` para qualquer falha, inclusive entrada malformada. Uma
 * exceção aqui viraria caminho de erro separado no chamador, e caminho de erro
 * separado em código de verificação é onde se instala a falha de segurança que
 * ninguém revisa.
 */
export async function verificar(
  chavePublica: CryptoKey | string,
  algoritmo: string,
  mensagem: string | Uint8Array,
  assinatura: string,
): Promise<boolean> {
  if (!ehAlgoritmoConhecido(algoritmo)) return false;

  try {
    const chave =
      typeof chavePublica === "string"
        ? await importarChavePublica(chavePublica, algoritmo)
        : chavePublica;

    const dados =
      typeof mensagem === "string" ? new TextEncoder().encode(mensagem) : mensagem;

    return await crypto.subtle.verify(
      PARAMETROS[algoritmo].assinatura as EcdsaParams,
      chave,
      deBase64Url(assinatura) as BufferSource,
      dados as BufferSource,
    );
  } catch {
    return false;
  }
}

/**
 * Impressão digital curta da chave pública, para exibir a quem está pareando.
 *
 * Serve para a pessoa comparar visualmente o que aparece no celular com o que
 * aparece no PC. Não substitui a verificação criptográfica — é conferência
 * humana, e por isso precisa ser curta o bastante para alguém ler em voz alta.
 */
export async function impressaoDigital(chavePublicaExportada: string): Promise<string> {
  const resumo = await crypto.subtle.digest(
    "SHA-256",
    deBase64Url(chavePublicaExportada) as BufferSource,
  );

  const bytes = new Uint8Array(resumo).slice(0, 8);
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return (hex.match(/.{4}/g) ?? []).join("-").toUpperCase();
}

// ---------------------------------------------------------------------------
// base64url
// ---------------------------------------------------------------------------

/*
 * base64url e não base64: o valor viaja em URL, em JSON e em cabeçalho, e os
 * caracteres `+`, `/` e `=` exigiriam escape diferente em cada um desses
 * lugares. Trocar de alfabeto uma vez evita três classes de bug de transporte.
 */

export function paraBase64Url(bytes: Uint8Array): string {
  let binario = "";
  for (const byte of bytes) binario += String.fromCharCode(byte);
  return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function deBase64Url(texto: string): Uint8Array {
  const base64 = texto.replace(/-/g, "+").replace(/_/g, "/");
  const preenchido = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binario = atob(preenchido);

  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}
