/**
 * Configuração do serviço, validada na partida.
 *
 * Falhar ao subir com uma mensagem clara é muito melhor do que subir e falhar
 * na primeira requisição — no segundo caso o sintoma aparece longe da causa, e
 * geralmente com o usuário na frente.
 */

export interface Config {
  producao: boolean;
  porta: number;
  databaseUrl: string;
  /** Origens da PWA autorizadas a conversar com esta API. */
  origensPermitidas: string[];
  /** Domínio do cookie. Vazio significa apenas o host que respondeu. */
  dominioCookie?: string;
  /** Falso só faz sentido em desenvolvimento local sobre http. */
  cookieSeguro: boolean;
  /** Endereço público que navegador e Agente usam para o WSS. */
  urlSinalizacao: string;
  /** Credencial de servidor usada apenas para emitir acessos TURN temporários. */
  turnCloudflare?: {
    chaveId: string;
    tokenApi: string;
    ttlSegundos: number;
  };
  /**
   * Relay TURN de credencial fixa, para quando não há emissor de credencial
   * temporária configurado.
   *
   * **É a rota de reserva, e sem ela a conexão depende da sorte do NAT de cada
   * casa.** Sem relay, celular e computador só se falam se conseguirem se achar
   * diretamente; onde o roteador isola clientes da mesma Wi-Fi — comportamento
   * padrão em muito roteador de operadora e em toda rede de visitante — não
   * existe caminho nenhum, nem pela rede local nem pelo endereço público, que
   * exigiria hairpin.
   *
   * A credencial fixa é inferior à temporária da Cloudflare, e isso é aceito de
   * propósito: uma credencial que vaza dá a terceiros o uso do relay, não
   * acesso ao conteúdo — o DTLS é fim a fim, e o relay encaminha bytes cifrados
   * sem poder lê-los. `turnCloudflare` continua tendo precedência quando existe.
   */
  turnFixo?: {
    urls: string[];
    usuario: string;
    senha: string;
  };
  /** Acesso servidor-servidor às releases privadas; nunca é enviado ao Agente. */
  releasesGitHub?: {
    token: string;
    repositorio: string;
    urlPublicaApi: string;
  };
}

export class ConfiguracaoInvalida extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ConfiguracaoInvalida";
  }
}

export function carregarConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const producao = env.NODE_ENV === "production";

  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new ConfiguracaoInvalida("DATABASE_URL não está definida.");
  }

  const origens = (env.ORIGENS_PERMITIDAS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  if (producao && origens.length === 0) {
    throw new ConfiguracaoInvalida(
      "ORIGENS_PERMITIDAS precisa ser definida em produção. " +
        "Sem ela, ou a API recusa a PWA, ou aceita qualquer site.",
    );
  }

  /*
   * Em produção o cookie sempre exige HTTPS, sem opção de desligar.
   *
   * Fora de produção o padrão é **não** exigir, e a razão é concreta: um
   * cookie `Secure` servido sobre `http://localhost` é aceito pelo Chromium,
   * que trata localhost como contexto seguro, e **recusado pelo WebKit**.
   *
   * A versão anterior tinha o padrão invertido, e o efeito foi exatamente esse:
   * o login funcionava no Chromium e falhava no motor de todo navegador do
   * iPhone e do iPad — cadastro respondia 201 e a requisição seguinte vinha
   * 401. Passei um bom tempo atrás de um problema de SameSite que não existia.
   */
  const cookieSeguro = producao ? true : env.COOKIE_SEGURO === "true";

  const urlSinalizacaoBruta =
    env.URL_SINALIZACAO?.trim() ||
    (env.RAILWAY_PUBLIC_DOMAIN
      ? `wss://${env.RAILWAY_PUBLIC_DOMAIN.trim()}/sinalizacao`
      : producao
        ? ""
        : "ws://localhost:4500/sinalizacao");

  if (!urlSinalizacaoBruta) {
    throw new ConfiguracaoInvalida(
      "URL_SINALIZACAO precisa ser definida em produção quando RAILWAY_PUBLIC_DOMAIN não existe.",
    );
  }

  let urlSinalizacao: URL;
  try {
    urlSinalizacao = new URL(urlSinalizacaoBruta);
  } catch {
    throw new ConfiguracaoInvalida("URL_SINALIZACAO não é uma URL válida.");
  }
  if (!["ws:", "wss:"].includes(urlSinalizacao.protocol)) {
    throw new ConfiguracaoInvalida("URL_SINALIZACAO precisa usar ws:// ou wss://.");
  }
  if (producao && urlSinalizacao.protocol !== "wss:") {
    throw new ConfiguracaoInvalida("URL_SINALIZACAO precisa usar wss:// em produção.");
  }

  const chaveTurn = env.CLOUDFLARE_TURN_KEY_ID?.trim();
  const tokenTurn = env.CLOUDFLARE_TURN_API_TOKEN?.trim();
  if (Boolean(chaveTurn) !== Boolean(tokenTurn)) {
    throw new ConfiguracaoInvalida(
      "CLOUDFLARE_TURN_KEY_ID e CLOUDFLARE_TURN_API_TOKEN precisam ser definidos juntos.",
    );
  }
  const ttlTurn = Number.parseInt(env.TURN_TTL_SEGUNDOS ?? "21600", 10);
  if (chaveTurn && (!Number.isInteger(ttlTurn) || ttlTurn < 300 || ttlTurn > 172_800)) {
    throw new ConfiguracaoInvalida(
      "TURN_TTL_SEGUNDOS precisa estar entre 300 e 172800 segundos.",
    );
  }

  // Relay de credencial fixa. As três variáveis andam juntas: um relay sem
  // usuário e senha não atende ninguém, e recusar na subida é melhor do que
  // anunciar aos clientes uma rota que vai falhar em toda tentativa.
  const urlsTurnFixo = (env.TURN_URLS ?? "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
  const usuarioTurnFixo = env.TURN_USUARIO?.trim();
  const senhaTurnFixo = env.TURN_SENHA?.trim();
  const partesTurnFixo = [urlsTurnFixo.length > 0, Boolean(usuarioTurnFixo), Boolean(senhaTurnFixo)];
  if (partesTurnFixo.some(Boolean) && !partesTurnFixo.every(Boolean)) {
    throw new ConfiguracaoInvalida(
      "TURN_URLS, TURN_USUARIO e TURN_SENHA precisam ser definidos juntos.",
    );
  }
  if (urlsTurnFixo.some((url) => !/^turns?:/.test(url))) {
    throw new ConfiguracaoInvalida("TURN_URLS aceita apenas endereços turn: ou turns:.");
  }

  const tokenReleases = env.GITHUB_RELEASE_TOKEN?.trim();
  const repositorioReleases = (env.GITHUB_RELEASE_REPOSITORY ?? "alanaraujo-bit/SLATE").trim();
  const urlPublicaApiBruta = (
    env.URL_PUBLICA_API ?? (producao ? "https://slate.aionixdev.com/api" : "http://localhost:4500")
  ).trim();
  if (tokenReleases && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repositorioReleases)) {
    throw new ConfiguracaoInvalida("GITHUB_RELEASE_REPOSITORY precisa usar o formato dono/repositorio.");
  }
  let urlPublicaApi: URL;
  try {
    urlPublicaApi = new URL(urlPublicaApiBruta);
  } catch {
    throw new ConfiguracaoInvalida("URL_PUBLICA_API não é uma URL válida.");
  }
  if (tokenReleases && producao && urlPublicaApi.protocol !== "https:") {
    throw new ConfiguracaoInvalida("URL_PUBLICA_API precisa usar HTTPS em produção.");
  }

  return {
    producao,
    porta: Number.parseInt(env.PORT ?? "4500", 10),
    databaseUrl,
    origensPermitidas: origens.length > 0 ? origens : ["http://localhost:4400"],
    dominioCookie: env.DOMINIO_COOKIE?.trim() || undefined,
    cookieSeguro,
    urlSinalizacao: urlSinalizacao.toString(),
    ...(chaveTurn && tokenTurn
      ? {
          turnCloudflare: {
            chaveId: chaveTurn,
            tokenApi: tokenTurn,
            ttlSegundos: ttlTurn,
          },
        }
      : {}),
    ...(urlsTurnFixo.length > 0 && usuarioTurnFixo && senhaTurnFixo
      ? {
          turnFixo: {
            urls: urlsTurnFixo,
            usuario: usuarioTurnFixo,
            senha: senhaTurnFixo,
          },
        }
      : {}),
    ...(tokenReleases
      ? {
          releasesGitHub: {
            token: tokenReleases,
            repositorio: repositorioReleases,
            urlPublicaApi: urlPublicaApi.toString().replace(/\/$/, ""),
          },
        }
      : {}),
  };
}

/**
 * Confere se uma origem pode falar com esta API.
 *
 * Comparação exata, sem curinga e sem "termina com". Uma verificação por
 * sufixo aceitaria `slate.aionixdev.com.site-malicioso.com`, que é o erro
 * clássico dessa checagem.
 */
export function origemPermitida(origem: string | null, config: Config): boolean {
  if (!origem) return false;
  return config.origensPermitidas.includes(origem);
}
