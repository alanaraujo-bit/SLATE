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
  removerParesRevogados,
} from "@/lib/identidade-local";
import { TransporteWebRtc } from "@/lib/transporte-webrtc";
import type { EstadoConexao } from "@/lib/estados-conexao";
import { decidirVinculo, type Vinculo } from "@/lib/vinculo";
import { EstadoDaConexao } from "./estado-da-conexao";
import { ControlesBasicos } from "./controles-basicos";
import { ConvitePareamentoQr } from "./convite-pareamento-qr";
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
  const [vinculo, setVinculo] = useState<Vinculo | null>(null);
  const [tentativa, setTentativa] = useState(0);
  /** Chave deste aparelho, para saber qual item da lista é ele mesmo. */
  const [chaveDestaSuperficie, setChaveDestaSuperficie] = useState<string | null>(null);
  const [agenteControlaMidia, setAgenteControlaMidia] = useState(false);
  const [agenteTemGradeCompleta, setAgenteTemGradeCompleta] = useState(false);
  const [agentePrincipalId, setAgentePrincipalId] = useState<string | null>(null);
  const [removendoDispositivo, setRemovendoDispositivo] = useState<string | null>(null);
  const [tokenConvite, setTokenConvite] = useState<string | null>(null);
  const [adicionandoComputador, setAdicionandoComputador] = useState(false);
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
      setVinculo(null);

      const lista = await api.dispositivos();
      if (lista.ok) setDispositivos(lista.dados.dispositivos);
      return;
    }

    // 401 é resposta legítima: quer dizer que não há sessão. Já falha de rede
    // é outra coisa, e precisa ser dita de outro jeito.
    setSituacao(eu.status === 0 ? "servidor-fora" : "deslogado");
  }, []);

  useEffect(() => {
    const parametros = new URLSearchParams(window.location.hash.slice(1));
    setTokenConvite(parametros.get("convite"));
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
      setChaveDestaSuperficie(identidade.chavePublicaExportada);
      const decidido = decidirVinculo(
        identidade.chavePublicaExportada,
        pares,
        dispositivos,
      );
      setVinculo(decidido);

      if (decidido.tipo !== "pronto") {
        setAgentePrincipalId(null);
        // Um computador que a conta tem mas este aparelho não reconhece não é
        // "conectando": é pareamento pendente, e dizer o contrário deixaria a
        // tela girando para sempre.
        setEstadoConexao("PAIRING_REQUIRED");
        return;
      }

      setAgentePrincipalId(decidido.agente.dispositivo.id);
      transporte = new TransporteWebRtc({
        identidade,
        agente: decidido.agente.par,
        aoMudarEstado: setEstadoConexao,
        aoNegociarCapacidades: (capacidades) => {
          setAgenteControlaMidia(capacidades.includes("action.media"));
          setAgenteTemGradeCompleta(capacidades.includes("action.media.completo"));
        },
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
  }, [situacao, dispositivos, tentativa]);

  // Vale acompanhar a presença tanto quando o computador confiável não
  // responde quanto quando não há vínculo: nos dois casos a saída é o
  // computador aparecer, e nos dois a pessoa está olhando para uma tela
  // esperando que algo mude.
  const acompanhandoPresenca =
    situacao === "logado" &&
    (estadoConexao === "AGENT_UNAVAILABLE" ||
      (vinculo !== null && vinculo.tipo !== "pronto"));

  useEffect(() => {
    if (!acompanhandoPresenca) return;

    // A presença pode mudar sem a página ser recarregada. Uma consulta
    // moderada permite migrar para outra instalação confiável que ficou
    // online, mas só altera o estado quando o resultado realmente mudou. Isso
    // evita reiniciar o WebRTC e martelar a API a cada tentativa de reconexão.
    const atualizarPresenca = async () => {
      const lista = await api.dispositivos();
      if (!lista.ok) return;

      setDispositivos((atuais) => {
        const assinatura = (itens: DispositivoResumo[]) =>
          itens
            .map((item) => `${item.id}:${item.situacao}:${item.online}`)
            .sort()
            .join("|");
        return assinatura(atuais) === assinatura(lista.dados.dispositivos)
          ? atuais
          : lista.dados.dispositivos;
      });
    };

    void atualizarPresenca();
    const intervalo = window.setInterval(() => void atualizarPresenca(), 7_500);
    return () => window.clearInterval(intervalo);
  }, [acompanhandoPresenca]);

  const sair = async () => {
    await api.sair();
    setUsuario(null);
    setDispositivos([]);
    setVinculo(null);
    setAgentePrincipalId(null);
    setSituacao("deslogado");
  };

  const reconectar = async () => {
    setEstadoConexao("CONNECTING");
    const lista = await api.dispositivos();
    if (lista.ok) setDispositivos(lista.dados.dispositivos);
    setTentativa((n) => n + 1);
  };

  const remover = async (dispositivo: DispositivoResumo) => {
    const ehEste =
      dispositivo.papel === "surface" && dispositivo.chavePublica === chaveDestaSuperficie;
    const pergunta = ehEste
      ? `Remover este aparelho da conta? Você precisará parear de novo para voltar a controlar o computador.`
      : `Remover ${dispositivo.nome}? ${
          dispositivo.papel === "agent"
            ? "Este computador precisará ser pareado novamente para voltar."
            : "Este aparelho deixa de controlar seus computadores."
        }`;
    if (!window.confirm(pergunta)) return;

    setRemovendoDispositivo(dispositivo.id);
    const resultado = await api.removerDispositivo(dispositivo.id);
    if (resultado.ok) {
      await removerParesRevogados([dispositivo.id]);
      await carregar();
    }
    setRemovendoDispositivo(null);
  };

  const instalacoesAntigas = dispositivos.filter(
    (d) => d.papel === "agent" && d.id !== agentePrincipalId && !d.online,
  );

  const encerrarConvite = async (concluido: boolean) => {
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    setTokenConvite(null);
    if (concluido) await carregar();
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

        {situacao === "logado" && tokenConvite && (
          <ConvitePareamentoQr
            token={tokenConvite}
            aoConcluir={() => void encerrarConvite(true)}
            aoCancelar={() => void encerrarConvite(false)}
          />
        )}

        {situacao === "logado" && !tokenConvite && vinculo === null && (
          <div className="aviso" aria-busy="true">
            <Rotulo tom="atenuado">Verificando o pareamento…</Rotulo>
          </div>
        )}

        {/* O computador da conta não é o que este aparelho conhece — quase
            sempre porque o Agente foi reinstalado e ganhou identidade nova.
            Antes isto aparecia como "conectando" e não saía do lugar. */}
        {situacao === "logado" && !tokenConvite && vinculo?.tipo === "computador-desconhecido" && (
          <Superficie nivel="elevada" preenchida>
            <div className="aviso">
              <h1 className="aviso__titulo">Parear de novo com {vinculo.nome}</h1>
              <p className="aviso__texto">
                {vinculo.online
                  ? `${vinculo.nome} está ligado agora, mas com uma identidade que este aparelho ainda não confirmou — é o que acontece depois de reinstalar o SLATE no computador.`
                  : `A conta tem ${vinculo.nome}, mas com uma identidade que este aparelho não reconhece e que não está ligada agora.`}{" "}
                Pareie uma vez e o aparelho volta a reconectar sozinho.
              </p>
              <PainelPareamento
                aoParear={() => void carregar()}
                aoLerConvite={setTokenConvite}
              />
            </div>
          </Superficie>
        )}

        {situacao === "logado" && !tokenConvite && vinculo?.tipo === "sem-computador" && (
          <Superficie nivel="elevada" preenchida>
            <div className="aviso">
              <h1 className="aviso__titulo">Nenhum computador na conta</h1>
              <p className="aviso__texto">
                Instale o SLATE no computador que você quer controlar e entre
                com esta mesma conta. Ele aparece aqui assim que abrir.
              </p>
            </div>
          </Superficie>
        )}

        {situacao === "logado" && !tokenConvite && vinculo?.tipo === "sem-superficie" && (
          <PainelPareamento
            aoParear={() => void carregar()}
            aoLerConvite={setTokenConvite}
          />
        )}

        {situacao === "logado" && !tokenConvite && vinculo?.tipo === "pronto" && adicionandoComputador && (
          <PainelPareamento
            aoParear={() => {
              setAdicionandoComputador(false);
              void carregar();
            }}
            aoLerConvite={setTokenConvite}
            aoCancelar={() => setAdicionandoComputador(false)}
          />
        )}

        {situacao === "logado" && !tokenConvite && vinculo?.tipo === "pronto" && !adicionandoComputador && (
          <Superficie nivel="elevada" preenchida>
            <div className="aviso">
              <h1 className="aviso__titulo">Dispositivos da sua conta</h1>

              <ul className="dispositivos">
                {dispositivos
                  .filter(
                    (d) =>
                      d.situacao !== "revogado" &&
                      (d.papel !== "agent" || d.id === agentePrincipalId),
                  )
                  .map((d) => (
                  <li className="dispositivo dispositivo--gerenciavel" key={d.id}>
                    <span>
                      <span className="dispositivo__nome">
                        {d.nome}
                        {d.chavePublica === chaveDestaSuperficie && " (este aparelho)"}
                      </span>
                      <Rotulo tamanho="xs" tom="sutil">
                        {d.papel === "agent" ? "Computador" : "Superfície"} ·{" "}
                        {d.papel === "agent"
                          ? d.online
                            ? "conectado agora"
                            : "desconectado"
                          : d.situacao === "ativo"
                            ? "ativo"
                            : d.situacao}
                      </Rotulo>
                    </span>
                    <Botao
                      tamanho="sm"
                      estado={removendoDispositivo === d.id ? "loading" : "idle"}
                      onClick={() => void remover(d)}
                    >
                      Remover
                    </Botao>
                  </li>
                ))}
              </ul>

              {/* A reconexão automática já tenta sozinha; este botão existe
                  para quem acabou de ligar o computador e não quer esperar o
                  próximo ciclo olhando para uma tela parada. */}
              {estadoConexao !== "CONNECTED" && (
                <Botao onClick={() => void reconectar()}>Reconectar agora</Botao>
              )}

              {instalacoesAntigas.length > 0 && (
                <details className="instalacoes-antigas">
                  <summary>
                    {instalacoesAntigas.length === 1
                      ? "1 instalação antiga"
                      : `${instalacoesAntigas.length} instalações antigas`}
                  </summary>
                  <p className="instalacoes-antigas__explicacao">
                    São identidades anteriores que estão desconectadas. O SLATE não as
                    usa enquanto o computador atual estiver disponível.
                  </p>
                  <ul className="dispositivos">
                    {instalacoesAntigas.map((d) => (
                      <li className="dispositivo dispositivo--gerenciavel" key={d.id}>
                        <span>
                          <span className="dispositivo__nome">{d.nome}</span>
                          <Rotulo tamanho="xs" tom="sutil">
                            Desconectado
                          </Rotulo>
                        </span>
                        <Botao
                          tamanho="sm"
                          estado={removendoDispositivo === d.id ? "loading" : "idle"}
                          onClick={() => void remover(d)}
                        >
                          Remover
                        </Botao>
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              <Botao onClick={() => setAdicionandoComputador(true)}>
                Conectar outro computador
              </Botao>

              <p className="aviso__texto">
                {estadoConexao === "CONNECTED"
                  ? agenteControlaMidia
                    ? "Canal seguro ativo. Seus comandos vão direto para o computador."
                    : "Canal seguro ativo. Atualize o Agente no computador para liberar os controles."
                  : "Os controles permanecem indisponíveis enquanto o computador não estiver conectado."}
              </p>
              {estadoConexao === "CONNECTED" && agenteControlaMidia && (
                <ControlesBasicos
                  gradeCompleta={agenteTemGradeCompleta}
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
