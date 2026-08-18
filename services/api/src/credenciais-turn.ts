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
    /*
     * Relay de credencial fixa, quando há um configurado.
     *
     * **STUN sozinho não é rota, é um espelho.** Ele só conta a cada lado qual
     * é o endereço público dele; quem precisa atravessar continua sendo os
     * dois. Onde o roteador isola clientes da mesma Wi-Fi, o caminho de dentro
     * não existe e o de fora exigiria hairpin — e o resultado é uma tela de
     * "Conectando" que nunca sai disso, sem erro em lugar nenhum.
     *
     * O STUN continua na lista junto do relay, e na frente: o caminho direto é
     * mais rápido e mais barato, e o ICE escolhe o relay só quando ele é o
     * único que fecha.
     */
    const { turnFixo } = config;
    if (turnFixo) {
      return {
        servidoresIce: [
          ...STUN_PUBLICO,
          {
            urls: turnFixo.urls,
            username: turnFixo.usuario,
            credential: turnFixo.senha,
          },
        ],
        // Credencial fixa não vence, então não há quando renovar. `null` é o
        // que faz o cliente parar de reagendar a busca por credencial nova.
        iceExpiraEm: null,
      };
    }
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
