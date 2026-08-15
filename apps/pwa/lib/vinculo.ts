import type { DispositivoResumo } from "./api";
import type { ParConfiavel } from "./identidade-local";
import { selecionarAgente, type AgenteSelecionado } from "./selecionar-agente";

/**
 * Por que este aparelho não está controlando um computador.
 *
 * Antes, tudo o que não fosse "pronto" virava um único estado — "pareie com o
 * computador" — e a tela pedia pareamento até para quem já estava pareado e
 * só tinha o computador desligado. Três situações diferentes com a mesma
 * resposta é o que faz um sistema parecer burro: a pessoa faz o que a tela
 * mandou, nada muda, e não há como saber por quê.
 *
 * Cada caso aqui tem uma resposta diferente, e é por isso que eles existem
 * separados.
 */
export type Vinculo =
  /** Este celular ainda não é uma superfície ativa da conta. */
  | { tipo: "sem-superficie" }
  /** A conta não tem nenhum computador com o Agente instalado. */
  | { tipo: "sem-computador" }
  /**
   * A conta tem computador, mas nenhum que este aparelho reconheça.
   *
   * É o que acontece quando o Agente é reinstalado e ganha identidade nova: a
   * nuvem passa a listar um computador que o celular nunca confirmou. Insistir
   * na reconexão aqui é esperar para sempre por uma identidade que não existe
   * mais — o caminho é parear de novo, e a tela precisa dizer isso.
   */
  | { tipo: "computador-desconhecido"; nome: string; online: boolean }
  /** Há um par confiável; a conexão pode ser tentada. */
  | { tipo: "pronto"; agente: AgenteSelecionado };

export function decidirVinculo(
  chavePublicaDestaSuperficie: string,
  pares: readonly ParConfiavel[],
  dispositivos: readonly DispositivoResumo[],
): Vinculo {
  const superficie = dispositivos.find(
    (d) =>
      d.papel === "surface" &&
      d.situacao === "ativo" &&
      d.chavePublica === chavePublicaDestaSuperficie,
  );
  if (!superficie) return { tipo: "sem-superficie" };

  const agente = selecionarAgente(pares, dispositivos);
  if (agente) return { tipo: "pronto", agente };

  const agentesDaConta = dispositivos.filter(
    (d) => d.papel === "agent" && d.situacao === "ativo",
  );
  if (agentesDaConta.length === 0) return { tipo: "sem-computador" };

  // Entre vários, o que está online é o que a pessoa tem na frente dela agora.
  const provavel =
    agentesDaConta.find((d) => d.online) ?? (agentesDaConta[0] as DispositivoResumo);
  return { tipo: "computador-desconhecido", nome: provavel.nome, online: provavel.online };
}
