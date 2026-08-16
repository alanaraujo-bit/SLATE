"use client";

import { useState } from "react";
import { Icone, Rotulo } from "@slate/design-system";
import {
  CONTROLES_ATALHOS,
  CONTROLES_MIDIA,
  CONTROLES_VOLUME,
  visiveis,
  type Controle,
} from "@/lib/controles";
import type { ResultadoExecucaoAcao } from "@/lib/transporte-webrtc";

export function ControlesBasicos({
  executar,
  gradeCompleta = false,
  atalhosLiberados = false,
}: {
  executar: (actionId: string) => Promise<ResultadoExecucaoAcao>;
  /** O Agente anunciou `action.media.completo` no handshake. */
  gradeCompleta?: boolean;
  /**
   * O Agente anunciou `action.atalhos` — ou seja, este aparelho recebeu a
   * permissão de abrir programas naquele computador, marcada lá.
   */
  atalhosLiberados?: boolean;
}) {
  /**
   * Só o erro vira texto na tela.
   *
   * Antes a grade esperava a resposta antes de aceitar o toque seguinte, e
   * volume ficava impraticável: cada aperto exigia uma ida e volta inteira até
   * o computador. Num painel de atalhos isso é defeito, não cautela — apertar
   * cinco vezes precisa mandar cinco comandos.
   *
   * O transporte já aceita pedidos simultâneos (cada um tem id próprio e é
   * resolvido pelo mapa de pendentes), então não havia nada a proteger. Agora
   * o toque dispara e pronto. A confirmação de que funcionou é o computador
   * reagir; anunciar "deu certo" a cada toque só empilharia ruído.
   */
  const [erro, setErro] = useState<string | null>(null);

  const acionar = (actionId: string) => {
    void executar(actionId).then((r) => setErro(r.ok ? null : r.mensagem));
  };

  const midia = visiveis(CONTROLES_MIDIA, gradeCompleta);
  const volume = visiveis(CONTROLES_VOLUME, gradeCompleta);

  const botao = (controle: Controle) => (
    <button
      key={controle.actionId}
      type="button"
      className={`tecla${controle.destaque ? " tecla--destaque" : ""}`}
      // Sem `disabled`: nenhuma tecla espera outra. O retorno ao dedo é o
      // `:active` do CSS, que é imediato e não depende da rede.
      onClick={() => acionar(controle.actionId)}
    >
      <Icone nome={controle.icone} aria-hidden />
      <span>{controle.rotulo}</span>
    </button>
  );

  return (
    <section
      // Com um Agente antigo só sobra o grupo de mídia, e a divisão em duas
      // colunas do modo deitado deixaria metade da tela vazia.
      className={`painel${
        volume.length === 0 && !atalhosLiberados ? " painel--coluna-unica" : ""
      }`}
      aria-label="Controles do computador"
    >
      <div className="painel__grupo">
        <div className="painel__cabecalho">
          <h2>Mídia</h2>
          <Rotulo tamanho="xs" tom="sutil">
            Funciona com o aplicativo de mídia ativo no Windows.
          </Rotulo>
        </div>
        <div className="grade-teclas">{midia.map(botao)}</div>
      </div>

      {volume.length > 0 && (
        <div className="painel__grupo">
          <div className="painel__cabecalho">
            <h2>Volume</h2>
          </div>
          <div className="grade-teclas">{volume.map(botao)}</div>
        </div>
      )}

      {atalhosLiberados && (
        <div className="painel__grupo">
          <div className="painel__cabecalho">
            <h2>Abrir</h2>
            <Rotulo tamanho="xs" tom="sutil">
              Abre no navegador padrão do computador.
            </Rotulo>
          </div>
          <div className="grade-teclas">{CONTROLES_ATALHOS.map(botao)}</div>
        </div>
      )}

      {!gradeCompleta && (
        <Rotulo tamanho="xs" tom="sutil">
          Atualize o Agente no computador para liberar faixa, parada e volume.
        </Rotulo>
      )}

      {gradeCompleta && !atalhosLiberados && (
        <Rotulo tamanho="xs" tom="sutil">
          Para abrir programas, autorize este aparelho na janela do SLATE no
          computador. A permissão é dada lá de propósito: nenhum aparelho amplia
          os próprios poderes à distância.
        </Rotulo>
      )}

      {erro && (
        <p className="controle-resultado controle-resultado--erro" role="alert">
          {erro}
        </p>
      )}
    </section>
  );
}
