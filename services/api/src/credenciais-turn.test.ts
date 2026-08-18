import { describe, expect, it, vi } from "vitest";
import type { Config } from "./config";
import { obterConfiguracaoIce } from "./credenciais-turn";

const base: Config = {
  producao: false,
  porta: 4500,
  databaseUrl: "postgresql://teste",
  origensPermitidas: ["http://localhost:4400"],
  cookieSeguro: false,
  urlSinalizacao: "ws://localhost:4500/sinalizacao",
};

describe("credenciais TURN", () => {
  it("usa STUN público sem inventar credencial quando TURN não foi configurado", async () => {
    expect(await obterConfiguracaoIce(base)).toEqual({
      servidoresIce: [{ urls: ["stun:stun.cloudflare.com:3478"] }],
      iceExpiraEm: null,
    });
  });

  it("mantém o segredo no servidor e devolve credencial temporária validada", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ Authorization: "Bearer segredo-servidor" });
      return new Response(
        JSON.stringify({
          iceServers: [
            { urls: ["stun:stun.cloudflare.com:53", "stun:stun.cloudflare.com:3478"] },
            {
              urls: [
                "turn:turn.cloudflare.com:53?transport=udp",
                "turn:turn.cloudflare.com:3478?transport=udp",
                "turns:turn.cloudflare.com:443?transport=tcp",
              ],
              username: "temporario",
              credential: "temporaria",
            },
          ],
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const resultado = await obterConfiguracaoIce(
      {
        ...base,
        turnCloudflare: {
          chaveId: "chave-id",
          tokenApi: "segredo-servidor",
          ttlSegundos: 3_600,
        },
      },
      fetchImpl,
      () => 1_000,
    );

    expect(resultado.iceExpiraEm).toBe(3_601_000);
    expect(JSON.stringify(resultado)).not.toContain("segredo-servidor");
    expect(resultado.servidoresIce.flatMap((s) => s.urls)).not.toContain(
      "turn:turn.cloudflare.com:53?transport=udp",
    );
  });
});

describe("relay de credencial fixa", () => {
  it("entra na lista junto do STUN, e depois dele", async () => {
    // O relay é rota de reserva, não substituto: o caminho direto continua
    // sendo tentado primeiro porque é mais rápido e não custa banda de
    // ninguém. O que o relay resolve é a casa onde o direto não fecha.
    const config = {
      ...base,
      turnFixo: {
        urls: ["turn:relay.exemplo:80", "turns:relay.exemplo:443"],
        usuario: "quem",
        senha: "segredo",
      },
    } as unknown as Config;

    const { servidoresIce, iceExpiraEm } = await obterConfiguracaoIce(config);

    expect(servidoresIce[0]?.urls[0]).toMatch(/^stun:/);
    expect(servidoresIce[1]).toEqual({
      urls: ["turn:relay.exemplo:80", "turns:relay.exemplo:443"],
      username: "quem",
      credential: "segredo",
    });
    // Credencial fixa não vence, então não há renovação a agendar.
    expect(iceExpiraEm).toBeNull();
  });

  it("sem relay nenhum, sobra só o espelho", async () => {
    // O estado em que o projeto ficou até hoje: STUN conta a cada lado qual é
    // o endereço público dele e não atravessa nada. Onde o caminho direto não
    // existe, a tela fica em "Conectando" para sempre.
    const { servidoresIce } = await obterConfiguracaoIce(base);
    expect(servidoresIce).toHaveLength(1);
    expect(servidoresIce[0]?.urls[0]).toMatch(/^stun:/);
  });
});
