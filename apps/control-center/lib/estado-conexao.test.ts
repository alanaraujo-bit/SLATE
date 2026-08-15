import { describe, expect, it } from "vitest";
import {
  QUEDA_MS,
  TOLERANCIA_MS,
  avaliarConexao,
} from "./estado-conexao";

/**
 * A regra de estado da conexão, verificada de forma determinística.
 *
 * Estes casos existiam antes como testes de ponta a ponta que derrubavam a
 * rede do navegador. Eram intermitentes: `setOffline` nem sempre corta uma
 * conexão SSE já aberta, então o teste às vezes verificava a regra e às vezes
 * verificava nada — e falhava sem que houvesse defeito.
 *
 * A regra não deixou de ser coberta; passou a ser coberta com mais rigor, nos
 * limites exatos, sem depender do emulador. O teste de ponta a ponta que
 * sobrou é o que realmente precisa de navegador: o fluxo entrega dado e a
 * página se mantém ao vivo.
 */

describe("avaliarConexao", () => {
  it("está ao vivo quando acabou de receber", () => {
    expect(avaliarConexao(0)).toBe("live");
  });

  it("continua ao vivo durante um engasgo curto", () => {
    // O servidor sinaliza a cada 5s; perder um sinal não pode virar alarme.
    expect(avaliarConexao(5_000)).toBe("live");
    expect(avaliarConexao(TOLERANCIA_MS - 1)).toBe("live");
  });

  it("acusa reconexão quando o silêncio passa da tolerância", () => {
    expect(avaliarConexao(TOLERANCIA_MS + 1)).toBe("reconnecting");
  });

  it("segue em reconexão até o limite de queda", () => {
    expect(avaliarConexao(QUEDA_MS - 1)).toBe("reconnecting");
  });

  it("acusa queda quando o silêncio passa do limite", () => {
    expect(avaliarConexao(QUEDA_MS + 1)).toBe("offline");
  });

  it("nunca volta a dizer ao vivo conforme o silêncio cresce", () => {
    // A propriedade que importa: o estado só pode piorar enquanto nada chega.
    // Um relato que oscila é pior que um relato ruim.
    const ordem = { live: 0, reconnecting: 1, offline: 2 } as const;
    let anterior = 0;

    for (let silencio = 0; silencio <= 60_000; silencio += 500) {
      const atual = ordem[avaliarConexao(silencio)];
      expect(atual, `silêncio de ${silencio}ms`).toBeGreaterThanOrEqual(anterior);
      anterior = atual;
    }
  });

  it("a tolerância cobre mais de um sinal de vida perdido", () => {
    // Se a tolerância fosse menor que dois intervalos de sinal, um único
    // pacote perdido acusaria problema onde não há.
    const INTERVALO_SINAL_MS = 5_000;
    expect(TOLERANCIA_MS).toBeGreaterThan(INTERVALO_SINAL_MS * 2);
  });

  it("o limite de queda é maior que o de tolerância", () => {
    expect(QUEDA_MS).toBeGreaterThan(TOLERANCIA_MS);
  });

  it("trata silêncio negativo como ao vivo em vez de quebrar", () => {
    // Relógio do cliente adiantado em relação ao carimbo produz isso. Não pode
    // virar estado esquisito.
    expect(avaliarConexao(-1_000)).toBe("live");
  });
});
