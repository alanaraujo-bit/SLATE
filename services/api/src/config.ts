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
