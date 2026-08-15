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
const railway = { RAILWAY_PUBLIC_DOMAIN: "slate-api.exemplo.up.railway.app" };

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
        ...railway,
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
        ...railway,
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
    expect(() => carregarConfig({ ...base, ...railway, NODE_ENV: "production" })).toThrow(
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

describe("endereço da sinalização", () => {
  it("usa o Agente local em desenvolvimento", () => {
    expect(carregarConfig({ ...base }).urlSinalizacao).toBe(
      "ws://localhost:4500/sinalizacao",
    );
  });

  it("deriva WSS do domínio público entregue pelo Railway", () => {
    const config = carregarConfig({
      ...base,
      NODE_ENV: "production",
      ORIGENS_PERMITIDAS: "https://slate.aionixdev.com",
      RAILWAY_PUBLIC_DOMAIN: "slate-api.exemplo.up.railway.app",
    });
    expect(config.urlSinalizacao).toBe(
      "wss://slate-api.exemplo.up.railway.app/sinalizacao",
    );
  });

  it("recusa transporte sem TLS em produção", () => {
    expect(() =>
      carregarConfig({
        ...base,
        NODE_ENV: "production",
        ORIGENS_PERMITIDAS: "https://slate.aionixdev.com",
        URL_SINALIZACAO: "ws://api.exemplo.test/sinalizacao",
      }),
    ).toThrow(ConfiguracaoInvalida);
  });
});

describe("banco", () => {
  it("recusa subir sem DATABASE_URL", () => {
    // Falhar ao subir é melhor do que falhar na primeira requisição, com o
    // sintoma longe da causa.
    expect(() => carregarConfig({})).toThrow(ConfiguracaoInvalida);
  });
});

describe("releases privadas", () => {
  it("mantém o token apenas na configuração do servidor", () => {
    const config = carregarConfig({
      ...base,
      GITHUB_RELEASE_TOKEN: "token",
      GITHUB_RELEASE_REPOSITORY: "alanaraujo-bit/SLATE",
      URL_PUBLICA_API: "https://slate.aionixdev.com/api",
    });
    expect(config.releasesGitHub).toEqual({
      token: "token",
      repositorio: "alanaraujo-bit/SLATE",
      urlPublicaApi: "https://slate.aionixdev.com/api",
    });
  });

  it("recusa endpoint sem HTTPS em produção", () => {
    expect(() =>
      carregarConfig({
        ...base,
        ...railway,
        NODE_ENV: "production",
        ORIGENS_PERMITIDAS: "https://slate.aionixdev.com",
        GITHUB_RELEASE_TOKEN: "token",
        URL_PUBLICA_API: "http://api.exemplo.test",
      }),
    ).toThrow(ConfiguracaoInvalida);
  });
});
