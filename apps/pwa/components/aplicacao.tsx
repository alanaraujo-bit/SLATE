"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Botao, Rotulo, Superficie } from "@slate/design-system";
import {
  api,
  EVENTO_SEM_CONEXAO,
  type DispositivoResumo,
  type Usuario,
} from "@/lib/api";
import {
  listarParesConfiaveis,
  obterOuCriarIdentidade,
} from "@/lib/identidade-local";
import { TransporteWebRtc } from "@/lib/transporte-webrtc";
import type { EstadoConexao } from "@/lib/estados-conexao";
import { EstadoDaConexao } from "./estado-da-conexao";
import { ControlesBasicos } from "./controles-basicos";
import { FormularioConta } from "./formulario-conta";
import { PainelPareamento } from "./painel-pareamento";

type Situacao = "carregando" | "deslogado" | "logado" | "servidor-fora";

/**
 * Decide o que mostrar.
 *
 * Os quatro estados são explícitos, incluindo o de servidor inacessível — sem
 * ele, uma API fora do ar apareceria como tela de login, e a pessoa tentaria
 * entrar repetidamente sem entender por que nada acontece.
 */
export function Aplicacao() {
  const [situacao, setSituacao] = useState<Situacao>("carregando");
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [dispositivos, setDispositivos] = useState<DispositivoResumo[]>([]);
  const [estadoConexao, setEstadoConexao] = useState<EstadoConexao>("PAIRING_REQUIRED");
  const [temParConfiavel, setTemParConfiavel] = useState<boolean | null>(null);
  const [agenteControlaMidia, setAgenteControlaMidia] = useState(false);
  const transporteAtual = useRef<TransporteWebRtc | null>(null);

  const carregar = useCallback(async () => {
    // Sem rede, nem adianta perguntar. Mostrar o formulário de entrada aqui
    // levaria a pessoa a preencher e-mail e senha para receber um erro no
    // final — pior do que dizer de saída que o servidor está fora de alcance.
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setSituacao("servidor-fora");
      return;
    }

    const eu = await api.eu();

    if (eu.ok) {
      setUsuario(eu.dados.usuario);
      setSituacao("logado");
      setTemParConfiavel(null);

      const lista = await api.dispositivos();
      if (lista.ok) setDispositivos(lista.dados.dispositivos);
      return;
    }

    // 401 é resposta legítima: quer dizer que não há sessão. Já falha de rede
    // é outra coisa, e precisa ser dita de outro jeito.
    setSituacao(eu.status === 0 ? "servidor-fora" : "deslogado");
  }, []);

  useEffect(() => {
    void carregar();

    // A rede volta sozinha com frequência; quando voltar, a tela se recupera
    // sem exigir que a pessoa recarregue.
    const aoVoltar = () => void carregar();
    const aoPerder = () => {
      setSituacao("servidor-fora");
      setEstadoConexao("OFFLINE");
    };
    window.addEventListener("online", aoVoltar);
    window.addEventListener("offline", aoPerder);
    window.addEventListener(EVENTO_SEM_CONEXAO, aoPerder);
    return () => {
      window.removeEventListener("online", aoVoltar);
      window.removeEventListener("offline", aoPerder);
      window.removeEventListener(EVENTO_SEM_CONEXAO, aoPerder);
    };
  }, [carregar]);

  useEffect(() => {
    if (situacao !== "logado") {
      setEstadoConexao(
        situacao === "servidor-fora" && typeof navigator !== "undefined" && !navigator.onLine
          ? "OFFLINE"
          : situacao === "deslogado"
            ? "AUTH_REQUIRED"
            : "PAIRING_REQUIRED",
      );
      return;
    }

    let transporte: TransporteWebRtc | undefined;
    let cancelado = false;

    void Promise.all([obterOuCriarIdentidade(), listarParesConfiaveis()]).then(
      ([identidade, pares]) => {
      if (cancelado) return;
      const superficie = dispositivos.find(
        (d) =>
          d.papel === "surface" &&
          d.situacao === "ativo" &&
          d.chavePublica === identidade.chavePublicaExportada,
      );
      const agenteConfiavel = pares.find((d) => d.papel === "agent");
      const agenteAtivo = dispositivos.find(
        (d) =>
          d.id === agenteConfiavel?.id &&
          d.papel === "agent" &&
          d.situacao === "ativo" &&
          d.chavePublica === agenteConfiavel.chavePublica,
      );

      if (!superficie || !agenteConfiavel || !agenteAtivo) {
        setTemParConfiavel(false);
        setEstadoConexao("PAIRING_REQUIRED");
        return;
      }

      setTemParConfiavel(true);
      transporte = new TransporteWebRtc({
        identidade,
        agente: agenteConfiavel,
        aoMudarEstado: setEstadoConexao,
        aoNegociarCapacidades: (capacidades) =>
          setAgenteControlaMidia(capacidades.includes("action.media")),
      });
      transporteAtual.current = transporte;
      transporte.iniciar();
    });

    return () => {
      cancelado = true;
      transporte?.parar();
      setAgenteControlaMidia(false);
      if (transporteAtual.current === transporte) transporteAtual.current = null;
    };
  }, [situacao, dispositivos]);

  const sair = async () => {
    await api.sair();
    setUsuario(null);
    setDispositivos([]);
    setTemParConfiavel(null);
    setSituacao("deslogado");
  };

  return (
    <div className="app">
      <header className="app__cabecalho">
        <div className="marca">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="marca__simbolo" src="/icons/icon-192.png" alt="" />
          SLATE
        </div>

        <div className="app__acoes">
          <EstadoDaConexao estado={estadoConexao} />
          {situacao === "logado" && (
            <Botao tamanho="sm" onClick={sair}>
              Sair
            </Botao>
          )}
        </div>
      </header>

      <main className="app__corpo">
        {situacao === "carregando" && (
          <div className="aviso" aria-busy="true">
            <Rotulo tom="atenuado">Carregando…</Rotulo>
          </div>
        )}

        {situacao === "servidor-fora" && (
          <Superficie nivel="elevada" preenchida>
            <div className="aviso">
              <h1 className="aviso__titulo">Servidor fora de alcance</h1>
              <p className="aviso__texto">
                Não foi possível falar com o servidor do SLATE. Verifique sua
                conexão — assim que ela voltar, é só tentar de novo.
              </p>
              <Botao tom="acento" onClick={() => void carregar()}>
                Tentar de novo
              </Botao>
            </div>
          </Superficie>
        )}

        {situacao === "deslogado" && (
          <Superficie nivel="elevada" preenchida>
            <FormularioConta aoEntrar={() => void carregar()} />
          </Superficie>
        )}

        {situacao === "logado" && temParConfiavel === null && (
          <div className="aviso" aria-busy="true">
            <Rotulo tom="atenuado">Verificando o pareamento…</Rotulo>
          </div>
        )}

        {situacao === "logado" && temParConfiavel === false && (
          <PainelPareamento aoParear={() => void carregar()} />
        )}

        {situacao === "logado" && temParConfiavel === true && (
          <Superficie nivel="elevada" preenchida>
            <div className="aviso">
              <h1 className="aviso__titulo">Dispositivos da sua conta</h1>

              <ul className="dispositivos">
                {dispositivos.map((d) => (
                  <li className="dispositivo" key={d.id}>
                    <span className="dispositivo__nome">{d.nome}</span>
                    <Rotulo tamanho="xs" tom="sutil">
                      {d.papel === "agent" ? "Computador" : "Superfície"} ·{" "}
                      {d.situacao === "ativo" ? "ativo" : d.situacao}
                    </Rotulo>
                  </li>
                ))}
              </ul>

              <p className="aviso__texto">
                {estadoConexao === "CONNECTED"
                  ? agenteControlaMidia
                    ? "Canal seguro ativo. Seus comandos vão direto para o computador."
                    : "Canal seguro ativo. Atualize o Agente no computador para liberar os controles."
                  : "Os controles permanecem indisponíveis enquanto o computador não estiver conectado."}
              </p>
              {estadoConexao === "CONNECTED" && agenteControlaMidia && (
                <ControlesBasicos
                  executar={(actionId) =>
                    transporteAtual.current?.executarAcao(actionId) ??
                    Promise.resolve({
                      ok: false,
                      mensagem: "O computador não está conectado.",
                    })
                  }
                />
              )}
            </div>
          </Superficie>
        )}
      </main>

      {usuario && (
        <footer className="app__rodape">
          <Rotulo tamanho="2xs" tom="sutil">
            {usuario.email}
          </Rotulo>
        </footer>
      )}
    </div>
  );
}
