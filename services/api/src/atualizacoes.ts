import { z } from "zod";

const esquemaAsset = z
  .object({
    id: z.number().int().positive(),
    name: z.string().min(1),
    url: z.string().url(),
    browser_download_url: z.string().url(),
  })
  .passthrough();

const esquemaRelease = z
  .object({
    id: z.number().int().positive(),
    draft: z.boolean(),
    prerelease: z.boolean(),
    tag_name: z.string(),
    assets: z.array(esquemaAsset),
  })
  .passthrough();

const esquemaManifesto = z
  .object({
    version: z.string().regex(/^v?\d+\.\d+\.\d+$/),
    notes: z.string().optional(),
    pub_date: z.string().optional(),
    platforms: z.record(
      z.string(),
      z.object({
        signature: z.string().min(20),
        url: z.string().url(),
      }),
    ),
  })
  .strict();

type Fetch = typeof globalThis.fetch;
type Release = z.infer<typeof esquemaRelease>;

export interface ConfigAtualizacoes {
  token: string;
  repositorio: string;
  urlPublicaApi: string;
}

export type ConsultaAtualizacao =
  | { tipo: "nenhuma" }
  | {
      tipo: "disponivel";
      versao: string;
      notas?: string;
      publicadaEm?: string;
      url: string;
      assinatura: string;
    };

export class ErroAtualizacoes extends Error {
  constructor(
    mensagem: string,
    readonly codigo: "indisponivel" | "manifesto_invalido" | "pacote_ausente",
  ) {
    super(mensagem);
    this.name = "ErroAtualizacoes";
  }
}

export class ServicoAtualizacoesGitHub {
  private cache?: { ate: number; release: Release; manifesto: z.infer<typeof esquemaManifesto> };

  constructor(
    private readonly config: ConfigAtualizacoes,
    private readonly fetchImpl: Fetch = globalThis.fetch,
    private readonly agora = () => Date.now(),
  ) {}

  async consultar(
    alvo: string,
    arquitetura: string,
    versaoAtual: string,
  ): Promise<ConsultaAtualizacao> {
    if (alvo !== "windows" || !["x86_64", "aarch64", "i686"].includes(arquitetura)) {
      return { tipo: "nenhuma" };
    }

    const { release, manifesto } = await this.carregarUltimaRelease();
    if (!versaoMaior(manifesto.version, versaoAtual)) return { tipo: "nenhuma" };

    const plataforma = manifesto.platforms[`${alvo}-${arquitetura}`];
    if (!plataforma) return { tipo: "nenhuma" };

    const nomePacote = decodeURIComponent(new URL(plataforma.url).pathname.split("/").at(-1) ?? "");
    const pacote = release.assets.find(
      (asset) => asset.browser_download_url === plataforma.url || asset.name === nomePacote,
    );
    if (!pacote || !pacoteAtualizadorValido(pacote.name)) {
      throw new ErroAtualizacoes("Pacote NSIS não está na release.", "pacote_ausente");
    }

    return {
      tipo: "disponivel",
      versao: manifesto.version.replace(/^v/, ""),
      ...(manifesto.notes ? { notas: manifesto.notes } : {}),
      ...(manifesto.pub_date ? { publicadaEm: manifesto.pub_date } : {}),
      url: `${this.config.urlPublicaApi}/atualizacoes/download/${release.id}/${pacote.id}`,
      assinatura: plataforma.signature,
    };
  }

  async urlTemporaria(releaseId: number, assetId: number): Promise<string> {
    const release = await this.buscarRelease(releaseId);
    if (release.draft || release.prerelease) {
      throw new ErroAtualizacoes("Release não é pública.", "pacote_ausente");
    }
    const asset = release.assets.find((item) => item.id === assetId);
    if (!asset || !pacoteAtualizadorValido(asset.name)) {
      throw new ErroAtualizacoes("Pacote não pertence à release.", "pacote_ausente");
    }

    const resposta = await this.fetchImpl(asset.url, {
      headers: this.headers("application/octet-stream"),
      redirect: "manual",
    });
    const destino = resposta.headers.get("location");
    if (![301, 302, 303, 307, 308].includes(resposta.status) || !destino) {
      throw new ErroAtualizacoes("GitHub não entregou URL temporária.", "indisponivel");
    }
    const url = new URL(destino);
    if (url.protocol !== "https:") {
      throw new ErroAtualizacoes("GitHub entregou redirecionamento inseguro.", "indisponivel");
    }
    return url.toString();
  }

  private async carregarUltimaRelease() {
    if (this.cache && this.cache.ate > this.agora()) return this.cache;
    const release = await this.buscarJson(
      `https://api.github.com/repos/${this.config.repositorio}/releases/latest`,
      esquemaRelease,
    );
    const assetManifesto = release.assets.find((asset) => asset.name === "latest.json");
    if (!assetManifesto) {
      throw new ErroAtualizacoes("latest.json ausente.", "manifesto_invalido");
    }
    const manifesto = await this.buscarJson(assetManifesto.url, esquemaManifesto, "application/octet-stream");
    this.cache = { ate: this.agora() + 5 * 60_000, release, manifesto };
    return this.cache;
  }

  private buscarRelease(id: number) {
    return this.buscarJson(
      `https://api.github.com/repos/${this.config.repositorio}/releases/${id}`,
      esquemaRelease,
    );
  }

  private async buscarJson<T>(url: string, esquema: z.ZodType<T>, accept = "application/vnd.github+json") {
    const resposta = await this.fetchImpl(url, { headers: this.headers(accept) });
    if (!resposta.ok) {
      throw new ErroAtualizacoes(`GitHub respondeu ${resposta.status}.`, "indisponivel");
    }
    const analise = esquema.safeParse(await resposta.json().catch(() => null));
    if (!analise.success) {
      throw new ErroAtualizacoes("Resposta do GitHub não passou na validação.", "manifesto_invalido");
    }
    return analise.data;
  }

  private headers(accept: string) {
    return {
      Accept: accept,
      Authorization: `Bearer ${this.config.token}`,
      "User-Agent": "SLATE-Atualizador",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }
}

export function versaoMaior(candidata: string, atual: string): boolean {
  const ler = (valor: string) => valor.replace(/^v/, "").split(".").map(Number);
  const a = ler(candidata);
  const b = ler(atual);
  if (a.length !== 3 || b.length !== 3 || [...a, ...b].some((n) => !Number.isInteger(n) || n < 0)) {
    return false;
  }
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i]! > b[i]!;
  }
  return false;
}

function pacoteAtualizadorValido(nome: string) {
  // Tauri 2.11 assina o próprio instalador NSIS. O sufixo legado continua
  // aceito para que uma transição de bundler não quebre versões já publicadas.
  return /-setup\.exe$/.test(nome) || /-setup\.nsis\.zip$/.test(nome);
}
