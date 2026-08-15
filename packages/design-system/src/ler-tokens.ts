import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Lê os tokens direto do `tokens.css` e resolve as referências `var()`.
 *
 * Existe por causa de um erro real: a verificação de contraste rodava contra
 * uma cópia dos valores mantida à mão em TypeScript, então quando um token foi
 * corrigido no CSS em dois lugares e num deles não, os testes continuaram
 * verdes sobre a cópia certa enquanto o CSS servia a cor errada.
 *
 * Cópia de valores sempre diverge. O CSS é a fonte, e é ele que precisa ser
 * medido.
 */

export type MapaTokens = Record<string, string>;

const AQUI = dirname(fileURLToPath(import.meta.url));
const CAMINHO_CSS = resolve(AQUI, "tokens.css");

function semComentarios(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Extrai o corpo do bloco que começa em `seletor`, contando chaves para lidar
 * com o aninhamento dentro de `@media`.
 */
function extrairBloco(css: string, seletor: string): string {
  const inicio = css.indexOf(seletor);
  if (inicio === -1) throw new Error(`Bloco não encontrado: ${seletor}`);

  const abre = css.indexOf("{", inicio + seletor.length - 1);
  if (abre === -1) throw new Error(`Bloco sem abertura: ${seletor}`);

  let profundidade = 0;
  for (let i = abre; i < css.length; i++) {
    if (css[i] === "{") profundidade++;
    else if (css[i] === "}") {
      profundidade--;
      if (profundidade === 0) return css.slice(abre + 1, i);
    }
  }

  throw new Error(`Bloco sem fechamento: ${seletor}`);
}

function declaracoes(corpo: string): MapaTokens {
  const mapa: MapaTokens = {};
  for (const [, nome, valor] of corpo.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    if (nome && valor) mapa[nome] = valor.trim();
  }
  return mapa;
}

/** Resolve `var(--x)` até chegar a um valor literal. */
function resolver(mapa: MapaTokens): MapaTokens {
  const resolvido: MapaTokens = {};

  const buscar = (nome: string, visitados = new Set<string>()): string => {
    if (visitados.has(nome)) {
      throw new Error(`Referência circular em ${nome}`);
    }
    visitados.add(nome);

    const bruto = mapa[nome];
    if (bruto === undefined) return "";

    const referencia = bruto.match(/^var\((--[\w-]+)\)$/);
    return referencia?.[1] ? buscar(referencia[1], visitados) : bruto;
  };

  for (const nome of Object.keys(mapa)) resolvido[nome] = buscar(nome);
  return resolvido;
}

export interface TokensLidos {
  /** Tema escuro: o bloco `:root` base. */
  escuro: MapaTokens;
  /** Tema claro por escolha explícita do usuário. */
  claroExplicito: MapaTokens;
  /** Tema claro por preferência do sistema operacional. */
  claroPorPreferencia: MapaTokens;
}

export function lerTokens(caminho: string = CAMINHO_CSS): TokensLidos {
  const css = semComentarios(readFileSync(caminho, "utf8"));

  const base = declaracoes(extrairBloco(css, ":root {"));
  const explicito = declaracoes(extrairBloco(css, ':root[data-theme="light"]'));
  // Dentro do @media de preferência clara, o bloco se exclui quando o usuário
  // escolheu escuro explicitamente — daí o :not([data-theme="dark"]).
  const preferencia = declaracoes(
    extrairBloco(css, ':root:not([data-theme="dark"])'),
  );

  return {
    escuro: resolver(base),
    claroExplicito: resolver({ ...base, ...explicito }),
    claroPorPreferencia: resolver({ ...base, ...preferencia }),
  };
}

/** Só os tokens de cor resolvidos para hexadecimal, prontos para medição. */
export function coresDe(mapa: MapaTokens): MapaTokens {
  const cores: MapaTokens = {};
  for (const [nome, valor] of Object.entries(mapa)) {
    if (/^#[0-9a-fA-F]{3,8}$/.test(valor)) cores[nome] = valor;
  }
  return cores;
}
