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

  // Em produção o cookie tem que exigir HTTPS. Deixar isso como variável
  // ajustável seria abrir espaço para alguém desligar sem perceber o que
  // estaria desligando.
  const cookieSeguro = producao ? true : env.COOKIE_SEGURO !== "false";

  return {
    producao,
    porta: Number.parseInt(env.PORT ?? "4500", 10),
    databaseUrl,
    origensPermitidas: origens.length > 0 ? origens : ["http://localhost:4400"],
    dominioCookie: env.DOMINIO_COOKIE?.trim() || undefined,
    cookieSeguro,
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
