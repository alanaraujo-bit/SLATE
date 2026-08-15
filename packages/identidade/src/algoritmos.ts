/**
 * Algoritmos de assinatura aceitos para identidade de dispositivo.
 *
 * O ADR-0004 escolheu Ed25519, e a pesquisa confirmou que ele chegou a todos
 * os motores de navegador — Firefox 129, Safari 17, Chrome 137. Só que
 * "suportado por todos os motores" não é o mesmo que "disponível para todo
 * mundo": quem ainda está num Safari 16 ou num Chrome antigo não tem, e isso
 * era perto de um quinto dos usuários quando esta decisão foi tomada.
 *
 * Recusar esses aparelhos seria trocar acesso por elegância criptográfica.
 * Então o algoritmo é negociado: cada dispositivo declara com o que assina, e
 * quem verifica usa o que foi declarado. ECDSA P-256 existe em WebCrypto desde
 * o começo, o que fecha a lacuna sem exigir biblioteca externa.
 *
 * Ed25519 continua sendo o preferido, e por um motivo concreto: ECDSA precisa
 * de um número aleatório novo a cada assinatura, e se ele se repetir ou for
 * previsível a chave privada vaza. Em Ed25519 essa propriedade é estrutural,
 * não depende de acertar a implementação.
 */

export const ALGORITMOS = ["Ed25519", "ECDSA-P256"] as const;
export type Algoritmo = (typeof ALGORITMOS)[number];

/** Preferência, do melhor para o aceitável. */
export const ORDEM_PREFERENCIA: readonly Algoritmo[] = ["Ed25519", "ECDSA-P256"];

interface Parametros {
  geracao: EcKeyGenParams | Algorithm;
  assinatura: EcdsaParams | Algorithm;
  importacao: EcKeyImportParams | Algorithm;
}

export const PARAMETROS: Record<Algoritmo, Parametros> = {
  Ed25519: {
    geracao: { name: "Ed25519" },
    assinatura: { name: "Ed25519" },
    importacao: { name: "Ed25519" },
  },
  "ECDSA-P256": {
    geracao: { name: "ECDSA", namedCurve: "P-256" },
    assinatura: { name: "ECDSA", hash: "SHA-256" },
    importacao: { name: "ECDSA", namedCurve: "P-256" },
  },
};

/**
 * Testa o suporte de verdade, gerando uma chave.
 *
 * Consultar uma lista de navegadores erra: um motor pode anunciar o algoritmo
 * e falhar em uma configuração específica, e o usuário descobriria isso no
 * meio do pareamento. Gerar uma chave descartável custa milissegundos e
 * responde com certeza.
 */
export async function suportado(algoritmo: Algoritmo): Promise<boolean> {
  try {
    await crypto.subtle.generateKey(PARAMETROS[algoritmo].geracao as EcKeyGenParams, true, [
      "sign",
      "verify",
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * O melhor algoritmo que este ambiente consegue usar.
 *
 * Lança quando nenhum está disponível, em vez de devolver um padrão que iria
 * falhar mais adiante — a falha precisa aparecer antes do pareamento começar,
 * e não no meio dele.
 */
export async function melhorAlgoritmoDisponivel(): Promise<Algoritmo> {
  for (const algoritmo of ORDEM_PREFERENCIA) {
    if (await suportado(algoritmo)) return algoritmo;
  }

  throw new Error(
    "Nenhum algoritmo de assinatura disponível neste navegador. " +
      "É necessário suporte a Ed25519 ou ECDSA P-256 na Web Crypto API.",
  );
}

export function ehAlgoritmoConhecido(valor: string): valor is Algoritmo {
  return (ALGORITMOS as readonly string[]).includes(valor);
}
