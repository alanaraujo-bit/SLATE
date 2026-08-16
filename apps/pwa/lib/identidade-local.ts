import {
  exportarChavePublica,
  gerarIdentidade,
  type Algoritmo,
} from "@slate/identidade";

/**
 * Guarda a identidade deste aparelho.
 *
 * A chave privada é criada como não-extraível e persistida no IndexedDB, que
 * aceita guardar um `CryptoKey` sem que o material bruto passe pelo
 * JavaScript. O limite dessa proteção está declarado no ADR-0004: ela impede
 * *copiar* a chave, não impede *usá-la* enquanto a página está aberta.
 *
 * localStorage não serve aqui — ele só guarda texto, o que obrigaria a
 * exportar a chave privada e deixá-la legível por qualquer script.
 */

const BANCO = "slate-identidade";
const DEPOSITO = "chaves";
const DEPOSITO_PARES = "pares-confiaveis";
const DEPOSITO_ESTADO = "estado";
const CHAVE_UNICA = "dispositivo";
const CHAVE_PEDIDO = "pedido-pareamento";
const VERSAO = 2;

export interface IdentidadeGuardada {
  algoritmo: Algoritmo;
  chavePrivada: CryptoKey;
  chavePublica: CryptoKey;
  chavePublicaExportada: string;
  nome: string;
}

interface RegistroGuardado {
  algoritmo: Algoritmo;
  chavePrivada: CryptoKey;
  chavePublica: CryptoKey;
  nome: string;
}

export interface ParConfiavel {
  id: string;
  nome: string;
  papel: "agent";
  chavePublica: string;
  algoritmo: string;
  escopos: string[];
}

export interface PedidoPareamentoGuardado {
  pedidoId: string;
  codigo: string;
  codigoFormatado: string;
  expiraEm: number;
}

function abrir(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const pedido = indexedDB.open(BANCO, VERSAO);

    pedido.onupgradeneeded = () => {
      const bd = pedido.result;
      if (!bd.objectStoreNames.contains(DEPOSITO)) bd.createObjectStore(DEPOSITO);
      if (!bd.objectStoreNames.contains(DEPOSITO_PARES)) {
        bd.createObjectStore(DEPOSITO_PARES, { keyPath: "id" });
      }
      if (!bd.objectStoreNames.contains(DEPOSITO_ESTADO)) {
        bd.createObjectStore(DEPOSITO_ESTADO);
      }
    };

    pedido.onsuccess = () => resolve(pedido.result);
    pedido.onerror = () => reject(pedido.error);
  });
}

function transacionar<T>(
  deposito: string,
  modo: IDBTransactionMode,
  operacao: (armazenamento: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return abrir().then(
    (bd) =>
      new Promise<T>((resolve, reject) => {
        const transacao = bd.transaction(deposito, modo);
        const pedido = operacao(transacao.objectStore(deposito));

        pedido.onsuccess = () => resolve(pedido.result);
        pedido.onerror = () => reject(pedido.error);
        transacao.oncomplete = () => bd.close();
      }),
  );
}

export async function lerIdentidade(): Promise<IdentidadeGuardada | null> {
  if (typeof indexedDB === "undefined") return null;

  try {
    const registro = await transacionar<RegistroGuardado | undefined>(
      DEPOSITO,
      "readonly",
      (d) => d.get(CHAVE_UNICA),
    );

    if (!registro?.chavePrivada) return null;

    return {
      ...registro,
      chavePublicaExportada: await exportarChavePublica(registro.chavePublica),
    };
  } catch {
    // Navegação privada e alguns navegadores bloqueiam IndexedDB. Tratar como
    // "não existe" faz a aplicação criar uma identidade nova para a sessão em
    // vez de simplesmente quebrar.
    return null;
  }
}

/**
 * Devolve a identidade deste aparelho, criando na primeira vez.
 *
 * O nome é sugerido a partir do aparelho para que a lista de dispositivos da
 * conta seja legível — "Celular" e "Tablet" dizem mais do que um identificador.
 */
export async function obterOuCriarIdentidade(
  nomeSugerido?: string,
): Promise<IdentidadeGuardada> {
  const existente = await lerIdentidade();
  if (existente) return existente;

  const identidade = await gerarIdentidade();
  const nome = nomeSugerido ?? nomeDoAparelho();

  await transacionar(DEPOSITO, "readwrite", (d) =>
    d.put(
      {
        algoritmo: identidade.algoritmo,
        chavePrivada: identidade.chavePrivada,
        chavePublica: identidade.chavePublica,
        nome,
      } satisfies RegistroGuardado,
      CHAVE_UNICA,
    ),
  );

  return {
    algoritmo: identidade.algoritmo,
    chavePrivada: identidade.chavePrivada,
    chavePublica: identidade.chavePublica,
    chavePublicaExportada: identidade.chavePublicaExportada,
    nome,
  };
}

export async function esquecerIdentidade(): Promise<void> {
  try {
    await transacionar(DEPOSITO, "readwrite", (d) => d.delete(CHAVE_UNICA));
  } catch {
    /* sem armazenamento, não há o que apagar */
  }
}

/**
 * Troca a identidade deste aparelho por uma nova.
 *
 * Serve para um caso só: o servidor avisou que esta chave foi revogada. A
 * linha revogada continua no banco de propósito, para que a mesma chave nunca
 * volte a valer — então insistir com ela é beco sem saída, e a saída é chegar
 * ao pareamento com uma chave que ninguém conhece.
 *
 * O pedido em andamento morre junto: ele carrega a chave antiga e faria a
 * confirmação no computador falhar exatamente como antes.
 */
export async function renovarIdentidade(): Promise<IdentidadeGuardada> {
  const anterior = await lerIdentidade();
  await esquecerIdentidade();
  await esquecerPedidoPareamento();
  return obterOuCriarIdentidade(anterior?.nome);
}

/** Guarda a chave do computador recebida ao concluir a cerimônia física. */
export async function guardarParConfiavel(par: ParConfiavel): Promise<void> {
  if (
    par.papel !== "agent" ||
    par.chavePublica.length < 20 ||
    !["Ed25519", "ECDSA-P256"].includes(par.algoritmo)
  ) {
    throw new Error("computador confiável inválido");
  }
  await transacionar(DEPOSITO_PARES, "readwrite", (d) => d.put(par));
}

export async function listarParesConfiaveis(): Promise<ParConfiavel[]> {
  if (typeof indexedDB === "undefined") return [];
  try {
    return await transacionar<ParConfiavel[]>(DEPOSITO_PARES, "readonly", (d) =>
      d.getAll(),
    );
  } catch {
    return [];
  }
}

/** A sincronização da nuvem só pode retirar confiança, nunca criar ou trocar. */
export async function removerParesRevogados(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const bd = await abrir();
  await new Promise<void>((resolve, reject) => {
    const transacao = bd.transaction(DEPOSITO_PARES, "readwrite");
    const deposito = transacao.objectStore(DEPOSITO_PARES);
    for (const id of new Set(ids)) deposito.delete(id);
    transacao.oncomplete = () => {
      bd.close();
      resolve();
    };
    transacao.onerror = () => reject(transacao.error);
  });
}

export async function guardarPedidoPareamento(
  pedido: PedidoPareamentoGuardado,
): Promise<void> {
  await transacionar(DEPOSITO_ESTADO, "readwrite", (d) =>
    d.put(pedido, CHAVE_PEDIDO),
  );
}

export async function lerPedidoPareamento(): Promise<PedidoPareamentoGuardado | null> {
  try {
    const pedido = await transacionar<PedidoPareamentoGuardado | undefined>(
      DEPOSITO_ESTADO,
      "readonly",
      (d) => d.get(CHAVE_PEDIDO),
    );
    if (!pedido || pedido.expiraEm <= Date.now()) return null;
    return pedido;
  } catch {
    return null;
  }
}

export async function esquecerPedidoPareamento(): Promise<void> {
  try {
    await transacionar(DEPOSITO_ESTADO, "readwrite", (d) =>
      d.delete(CHAVE_PEDIDO),
    );
  } catch {
    /* nada persistido */
  }
}

/**
 * Nome provável do aparelho.
 *
 * Baseado no que o navegador informa. É palpite, não identificação — e por
 * isso a pessoa pode trocar depois.
 */
export function nomeDoAparelho(): string {
  if (typeof navigator === "undefined") return "Dispositivo";

  const ua = navigator.userAgent;

  if (/iPad/i.test(ua)) return "iPad";
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? "Celular Android" : "Tablet Android";
  if (/Macintosh/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "PC";

  return "Dispositivo";
}
