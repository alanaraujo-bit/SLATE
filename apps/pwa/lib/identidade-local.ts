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
const CHAVE_UNICA = "dispositivo";
const VERSAO = 1;

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

function abrir(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const pedido = indexedDB.open(BANCO, VERSAO);

    pedido.onupgradeneeded = () => {
      const bd = pedido.result;
      if (!bd.objectStoreNames.contains(DEPOSITO)) bd.createObjectStore(DEPOSITO);
    };

    pedido.onsuccess = () => resolve(pedido.result);
    pedido.onerror = () => reject(pedido.error);
  });
}

function transacionar<T>(
  modo: IDBTransactionMode,
  operacao: (deposito: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return abrir().then(
    (bd) =>
      new Promise<T>((resolve, reject) => {
        const transacao = bd.transaction(DEPOSITO, modo);
        const pedido = operacao(transacao.objectStore(DEPOSITO));

        pedido.onsuccess = () => resolve(pedido.result);
        pedido.onerror = () => reject(pedido.error);
        transacao.oncomplete = () => bd.close();
      }),
  );
}

export async function lerIdentidade(): Promise<IdentidadeGuardada | null> {
  if (typeof indexedDB === "undefined") return null;

  try {
    const registro = await transacionar<RegistroGuardado | undefined>("readonly", (d) =>
      d.get(CHAVE_UNICA),
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

  await transacionar("readwrite", (d) =>
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
    await transacionar("readwrite", (d) => d.delete(CHAVE_UNICA));
  } catch {
    /* sem armazenamento, não há o que apagar */
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
