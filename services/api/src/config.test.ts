import { describe, expect, it } from "vitest";
import { ConfiguracaoInvalida, carregarConfig, origemPermitida } from "./config";

/**
 * Configuração.
 *
 * O caso do cookie seguro está aqui porque já custou caro: um padrão invertido
 * fez o login funcionar no Chromium e falhar no WebKit, que é o motor de todo
 * navegador no iPhone e no iPad. O sintoma era sessão criada e perdida na
 * requisição seguinte, e o diagnóstico foi longe demais antes de chegar na
 * causa.
 */

const base = { DATABASE_URL: "postgresql://u:p@h:5432/d" };

describe("cookie seguro", () => {
  it("não exige HTTPS em desenvolvimento, por padrão", () => {
    // Cookie `Secure` sobre http://localhost é aceito pelo Chromium e recusado
    // pelo WebKit. O padrão precisa ser o que funciona nos dois.
    expect(carregarConfig({ ...base }).cookieSeguro).toBe(false);
  });

  it("pode ser ligado explicitamente em desenvolvimento", () => {
    expect(carregarConfig({ ...base, COOKIE_SEGURO: "true" }).cookieSeguro).toBe(true);
  });

  it("sempre exige HTTPS em produção", () => {
    expect(
      carregarConfig({
        ...base,
        NODE_ENV: "production",
        ORIGENS_PERMITIDAS: "https://slate.aionixdev.com",
      }).cookieSeguro,
    ).toBe(true);
  });

  it("não é possível desligar em produção", () => {
    // Se fosse possível, bastaria uma variável esquecida para servir a sessão
    // em texto claro.
    expect(
      carregarConfig({
        ...base,
        NODE_ENV: "production",
        COOKIE_SEGURO: "false",
        ORIGENS_PERMITIDAS: "https://slate.aionixdev.com",
      }).cookieSeguro,
    ).toBe(true);
  });
});

describe("origens", () => {
  it("exige a lista em produção", () => {
    // Sem ela, ou a API recusa a própria PWA, ou aceita qualquer site.
    expect(() => carregarConfig({ ...base, NODE_ENV: "production" })).toThrow(
      ConfiguracaoInvalida,
    );
  });

  it("usa localhost como padrão em desenvolvimento", () => {
    expect(carregarConfig({ ...base }).origensPermitidas).toContain(
      "http://localhost:4400",
    );
  });

  it("aceita várias origens separadas por vírgula", () => {
    const config = carregarConfig({
      ...base,
      ORIGENS_PERMITIDAS: "https://a.com, https://b.com",
    });
    expect(config.origensPermitidas).toEqual(["https://a.com", "https://b.com"]);
  });

  it("aceita apenas origem idêntica", () => {
    const config = carregarConfig({ ...base, ORIGENS_PERMITIDAS: "https://slate.com" });
    expect(origemPermitida("https://slate.com", config)).toBe(true);
  });

  it("recusa origem que apenas começa igual", () => {
    // O erro clássico de verificar por prefixo ou sufixo.
    const config = carregarConfig({ ...base, ORIGENS_PERMITIDAS: "https://slate.com" });

    for (const impostora of [
      "https://slate.com.site-malicioso.com",
      "https://slate.com.br",
      "http://slate.com",
      "https://sub.slate.com",
    ]) {
      expect(origemPermitida(impostora, config), impostora).toBe(false);
    }
  });

  it("recusa ausência de origem", () => {
    const config = carregarConfig({ ...base, ORIGENS_PERMITIDAS: "https://slate.com" });
    expect(origemPermitida(null, config)).toBe(false);
  });
});

describe("banco", () => {
  it("recusa subir sem DATABASE_URL", () => {
    // Falhar ao subir é melhor do que falhar na primeira requisição, com o
    // sintoma longe da causa.
    expect(() => carregarConfig({})).toThrow(ConfiguracaoInvalida);
  });
});
