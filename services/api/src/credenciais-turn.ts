import { z } from "zod";
import { servidorIce, type ServidorIce } from "@slate/protocol";
import type { Config } from "./config";

const respostaCloudflare = z.object({
  iceServers: z.array(servidorIce).min(1).max(8),
}).strict();

export interface ConfiguracaoIce {
  servidoresIce: ServidorIce[];
  iceExpiraEm: number | null;
}

const STUN_PUBLICO: ServidorIce[] = [
  { urls: ["stun:stun.cloudflare.com:3478"] },
];

/**
 * Gera credenciais TURN curtas no servidor. O token de emissão da Cloudflare
 * nunca entra na resposta nem no WebSocket; os clientes recebem somente o par
 * usuário/senha que expira.
 */
export async function obterConfiguracaoIce(
  config: Config,
  fetchImpl: typeof fetch = fetch,
  agora: () => number = Date.now,
): Promise<ConfiguracaoIce> {
  if (!config.turnCloudflare) {
    return { servidoresIce: STUN_PUBLICO, iceExpiraEm: null };
  }

  const { chaveId, tokenApi, ttlSegundos } = config.turnCloudflare;
  const resposta = await fetchImpl(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(chaveId)}/credentials/generate-ice-servers`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenApi}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl: ttlSegundos }),
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (!resposta.ok) throw new Error(`TURN respondeu ${resposta.status}`);

  const analise = respostaCloudflare.safeParse(await resposta.json());
  if (!analise.success) throw new Error("TURN respondeu fora do contrato");

  // A própria Cloudflare documenta que a porta 53 é bloqueada por navegadores.
  // Retirá-la evita esperar um timeout sem remover nenhum caminho utilizável.
  const servidoresIce = analise.data.iceServers
    .map((servidor) => ({
      ...servidor,
      urls: servidor.urls.filter((url) => !/:53(?:\?|$)/.test(url)),
    }))
    .filter((servidor) => servidor.urls.length > 0);
  if (servidoresIce.length === 0) throw new Error("TURN não devolveu rota utilizável");

  return {
    servidoresIce,
    iceExpiraEm: agora() + ttlSegundos * 1_000,
  };
}
