"use client";

import { Botao, Rotulo } from "@slate/design-system";
import type { DispositivoResumo, Usuario } from "@/lib/api";
import type { EstadoConexao } from "@/lib/estados-conexao";

/**
 * Ajustes: tudo que não é controle.
 *
 * Existe porque o painel e o gerenciamento da conta estavam no mesmo cartão, e
 * isso custava as duas coisas ao mesmo tempo. O painel nunca ganhava a tela —
 * num celular deitado, a lista de aparelhos empurrava os controles para fora —
 * e a lista de aparelhos ficava soterrada entre botões de mídia.
 *
 * A régua da separação é a frequência: controle é o que se usa o tempo todo,
 * ajuste é o que se mexe uma vez e esquece.
 */
export function Ajustes({
  usuario,
  dispositivos,
  instalacoesAntigas,
  chaveDestaSuperficie,
  agentePrincipalId,
  estadoConexao,
  removendo,
  aoRemover,
  aoReconectar,
  aoAdicionarComputador,
  aoSair,
}: {
  usuario: Usuario | null;
  dispositivos: DispositivoResumo[];
  instalacoesAntigas: DispositivoResumo[];
  chaveDestaSuperficie: string | null;
  agentePrincipalId: string | null;
  estadoConexao: EstadoConexao;
  removendo: string | null;
  aoRemover: (d: DispositivoResumo) => void;
  aoReconectar: () => void;
  aoAdicionarComputador: () => void;
  aoSair: () => void;
}) {
  const emUso = dispositivos.filter(
    (d) => d.situacao !== "revogado" && (d.papel !== "agent" || d.id === agentePrincipalId),
  );

  const linha = (d: DispositivoResumo, antiga = false) => (
    <li className="aparelho" key={d.id}>
      <span className="aparelho__identidade">
        <span className="aparelho__nome">
          {d.nome}
          {d.chavePublica === chaveDestaSuperficie && (
            <em className="aparelho__voce">este aparelho</em>
          )}
        </span>
        <Rotulo tamanho="xs" tom="sutil">
          {antiga
            ? "Instalação antiga · desconectada"
            : `${d.papel === "agent" ? "Computador" : "Superfície"} · ${
                d.papel === "agent"
                  ? d.online
                    ? "conectado agora"
                    : "desconectado"
                  : d.situacao === "ativo"
                    ? "ativo"
                    : d.situacao
              }`}
        </Rotulo>
      </span>
      <Botao
        tamanho="sm"
        estado={removendo === d.id ? "loading" : "idle"}
        onClick={() => aoRemover(d)}
      >
        Remover
      </Botao>
    </li>
  );

  return (
    <div className="ajustes">
      <section className="ajustes__bloco">
        <h2 className="ajustes__titulo">Aparelhos</h2>
        <ul className="aparelhos">{emUso.map((d) => linha(d))}</ul>

        {/* A reconexão automática já tenta sozinha; este botão existe para quem
            acabou de ligar o computador e não quer esperar o próximo ciclo
            olhando para uma tela parada. */}
        {estadoConexao !== "CONNECTED" && (
          <Botao onClick={aoReconectar}>Reconectar agora</Botao>
        )}

        <Botao onClick={aoAdicionarComputador}>Conectar outro computador</Botao>
      </section>

      {instalacoesAntigas.length > 0 && (
        <section className="ajustes__bloco">
          <details className="instalacoes-antigas">
            <summary>
              {instalacoesAntigas.length === 1
                ? "1 instalação antiga"
                : `${instalacoesAntigas.length} instalações antigas`}
            </summary>
            <p className="instalacoes-antigas__explicacao">
              São identidades anteriores que estão desconectadas. O SLATE não as usa
              enquanto o computador atual estiver disponível.
            </p>
            <ul className="aparelhos">
              {instalacoesAntigas.map((d) => linha(d, true))}
            </ul>
          </details>
        </section>
      )}

      <section className="ajustes__bloco">
        <h2 className="ajustes__titulo">Conta</h2>
        <div className="ajustes__linha">
          <Rotulo tamanho="sm" tom="atenuado">
            {usuario?.email}
          </Rotulo>
          <Botao tamanho="sm" onClick={aoSair}>
            Sair
          </Botao>
        </div>
      </section>
    </div>
  );
}
