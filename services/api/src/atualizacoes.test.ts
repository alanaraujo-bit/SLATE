import { describe, expect, it, vi } from "vitest";
import { ErroAtualizacoes, ServicoAtualizacoesGitHub, versaoMaior } from "./atualizacoes";
import { criarServidor } from "./servidor";
import type { Config } from "./config";

const config = {
  token: "segredo-do-servidor",
  repositorio: "alanaraujo-bit/SLATE",
  urlPublicaApi: "https://slate.aionixdev.com/api",
};

const pacote = {
  id: 22,
  name: "SLATE_0.2.0_x64-setup.exe",
  url: "https://api.github.com/repos/alanaraujo-bit/SLATE/releases/assets/22",
  browser_download_url: "https://github.com/alanaraujo-bit/SLATE/releases/download/slate-v0.2.0/SLATE_0.2.0_x64-setup.exe",
};
const release = {
  id: 11,
  draft: false,
  prerelease: false,
  tag_name: "slate-v0.2.0",
  assets: [
    {
      id: 21,
      name: "latest.json",
      url: "https://api.github.com/repos/alanaraujo-bit/SLATE/releases/assets/21",
      browser_download_url: "https://github.com/alanaraujo-bit/SLATE/releases/download/slate-v0.2.0/latest.json",
    },
    pacote,
  ],
};
const manifesto = {
  version: "0.2.0",
  notes: "Canal em tempo real mais estável.",
  pub_date: "2026-08-15T18:00:00Z",
  platforms: {
    "windows-x86_64": {
      signature: "assinatura-minisign-com-tamanho-suficiente",
      url: pacote.browser_download_url,
    },
  },
};

function json(valor: unknown, status = 200) {
  return new Response(JSON.stringify(valor), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("serviço de atualizações privadas", () => {
  it("transforma o manifesto privado em resposta consumível pelo Agente", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json(release)).mockResolvedValueOnce(json(manifesto));
    const servico = new ServicoAtualizacoesGitHub(config, fetch);

    await expect(servico.consultar("windows", "x86_64", "0.1.0")).resolves.toEqual({
      tipo: "disponivel",
      versao: "0.2.0",
      notas: manifesto.notes,
      publicadaEm: manifesto.pub_date,
      url: "https://slate.aionixdev.com/api/atualizacoes/download/11/22",
      assinatura: manifesto.platforms["windows-x86_64"].signature,
    });
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer segredo-do-servidor",
    });
  });

  it("responde sem atualização quando a versão não é maior", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json(release)).mockResolvedValueOnce(json(manifesto));
    const servico = new ServicoAtualizacoesGitHub(config, fetch);
    await expect(servico.consultar("windows", "x86_64", "0.2.0")).resolves.toEqual({
      tipo: "nenhuma",
    });
  });

  it("recusa manifesto que aponta para pacote alheio à release", async () => {
    const forjado = structuredClone(manifesto);
    forjado.platforms["windows-x86_64"].url = "https://malicioso.test/slate.nsis.zip";
    const fetch = vi.fn().mockResolvedValueOnce(json(release)).mockResolvedValueOnce(json(forjado));
    const servico = new ServicoAtualizacoesGitHub(config, fetch);
    await expect(servico.consultar("windows", "x86_64", "0.1.0")).rejects.toMatchObject({
      codigo: "pacote_ausente",
    });
  });

  it("só redireciona um pacote assinado que pertence à release publicada", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json(release))
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://objects.githubusercontent.com/pacote-temporario" },
        }),
      );
    const servico = new ServicoAtualizacoesGitHub(config, fetch);
    await expect(servico.urlTemporaria(11, 22)).resolves.toBe(
      "https://objects.githubusercontent.com/pacote-temporario",
    );
  });

  it("não transforma o endpoint em proxy para qualquer asset privado", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json(release));
    const servico = new ServicoAtualizacoesGitHub(config, fetch);
    await expect(servico.urlTemporaria(11, 999)).rejects.toBeInstanceOf(ErroAtualizacoes);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("comparação de versão", () => {
  it.each([
    ["0.2.0", "0.1.9", true],
    ["1.0.0", "0.99.99", true],
    ["0.1.0", "0.1.0", false],
    ["0.0.9", "0.1.0", false],
    ["forjada", "0.1.0", false],
  ])("compara %s com %s", (candidata, atual, esperado) => {
    expect(versaoMaior(candidata, atual)).toBe(esperado);
  });
});

describe("contrato HTTP consumido pelo Tauri", () => {
  const configServidor: Config = {
    producao: false,
    porta: 4500,
    databaseUrl: "postgres://teste",
    origensPermitidas: ["http://localhost:4400"],
    cookieSeguro: false,
    urlSinalizacao: "ws://localhost:4500/sinalizacao",
  };

  it("entrega os nomes exatos esperados pelo plugin", async () => {
    const atualizacoes = {
      consultar: vi.fn().mockResolvedValue({
        tipo: "disponivel",
        versao: "0.2.0",
        notas: "Mais claro e seguro.",
        publicadaEm: "2026-08-15T18:00:00Z",
        url: "https://slate.aionixdev.com/api/atualizacoes/download/11/22",
        assinatura: "assinatura-minisign-com-tamanho-suficiente",
      }),
      urlTemporaria: vi.fn(),
    } as unknown as ServicoAtualizacoesGitHub;
    const app = criarServidor({ db: null as never, config: configServidor, atualizacoes });

    const resposta = await app.request("/atualizacoes/windows/x86_64/0.1.0");

    expect(resposta.status).toBe(200);
    await expect(resposta.json()).resolves.toEqual({
      version: "0.2.0",
      notes: "Mais claro e seguro.",
      pub_date: "2026-08-15T18:00:00Z",
      url: "https://slate.aionixdev.com/api/atualizacoes/download/11/22",
      signature: "assinatura-minisign-com-tamanho-suficiente",
    });
  });

  it("usa 204 quando a versão instalada já é a mais nova", async () => {
    const atualizacoes = {
      consultar: vi.fn().mockResolvedValue({ tipo: "nenhuma" }),
      urlTemporaria: vi.fn(),
    } as unknown as ServicoAtualizacoesGitHub;
    const app = criarServidor({ db: null as never, config: configServidor, atualizacoes });

    const resposta = await app.request("/atualizacoes/windows/x86_64/0.2.0");

    expect(resposta.status).toBe(204);
    expect(await resposta.text()).toBe("");
  });

  it("redireciona somente para a URL temporária validada pelo serviço", async () => {
    const atualizacoes = {
      consultar: vi.fn(),
      urlTemporaria: vi.fn().mockResolvedValue("https://objects.githubusercontent.com/pacote"),
    } as unknown as ServicoAtualizacoesGitHub;
    const app = criarServidor({ db: null as never, config: configServidor, atualizacoes });

    const resposta = await app.request("/atualizacoes/download/11/22");

    expect(resposta.status).toBe(302);
    expect(resposta.headers.get("location")).toBe("https://objects.githubusercontent.com/pacote");
  });
});
