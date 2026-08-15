export type EstadoConexao = "live" | "reconnecting" | "offline";

/**
 * Tolerância antes de admitir que a conexão está com problema.
 *
 * O servidor manda um sinal de vida a cada 5s, então este valor precisa cobrir
 * mais de um sinal perdido — senão um engasgo da rede vira alarme. Também não
 * pode ser generoso demais: uma página que afirma estar ao vivo enquanto não
 * recebe nada é pior que uma que admite o problema.
 */
export const TOLERANCIA_MS = 12_000;

/** A partir daqui não é mais engasgo: é queda. */
export const QUEDA_MS = 30_000;

/**
 * Estado da conexão em função do silêncio, e só dele.
 *
 * Uma versão anterior também consultava se o socket parecia aberto, e ignorava
 * o silêncio enquanto parecesse. Isso abria uma faixa em que a página seguia
 * dizendo "ao vivo" sem receber nada havia dez segundos — e um socket aberto
 * que não entrega é indistinguível de um quebrado para quem olha a tela.
 *
 * Fica como função pura, separada do hook, porque é a regra que realmente
 * importa e ela merece ser verificada sem depender de um navegador emulado
 * cortar conexão na hora certa.
 */
export function avaliarConexao(silencioMs: number): EstadoConexao {
  if (silencioMs > QUEDA_MS) return "offline";
  if (silencioMs > TOLERANCIA_MS) return "reconnecting";
  return "live";
}
