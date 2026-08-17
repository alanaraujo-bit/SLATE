import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { QRCodeSVG } from "qrcode.react";
import { Botao, Icone, Rotulo } from "@slate/design-system";
import { Modal } from "../modal";
import type { Dispositivo, Situacao } from "../tipos";

interface ConviteQr {
  conviteId: string;
  expiraEm: string;
  url: string;
}

interface SituacaoConviteQr {
  situacao: "pendente" | "expirado" | "confirmado";
  dispositivo?: Dispositivo;
}

export function TelaAparelhos({
  situacao,
  aoMudar,
}: {
  situacao: Situacao;
  aoMudar: () => void;
}) {
  const [codigo, setCodigo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [modo, setModo] = useState<"qr" | "codigo">("qr");
  const [aRemover, setARemover] = useState<Dispositivo | null>(null);
  const [removendo, setRemovendo] = useState<string | null>(null);
  const [alterandoAtalhos, setAlterandoAtalhos] = useState<string | null>(null);

  const superficies = situacao.dispositivos.filter(
    (d) => d.papel === "surface" && d.situacao !== "revogado",
  );

  const [pediuParear, setPediuParear] = useState(false);

  /**
   * A tela de pareamento aparece por vontade da pessoa **ou** por não haver
   * aparelho nenhum.
   *
   * A segunda metade é derivada da lista, e não guardada em estado, porque a
   * lista muda enquanto a janela está aberta. Quando isto nascia de
   * `useState(superficies.length === 0)`, remover o último aparelho deixava a
   * tela sem saída: a lista ia a zero, o valor guardado continuava `false` e o
   * botão "Parear outro" só existia quando havia algum.
   */
  const parear = pediuParear || superficies.length === 0;

  const conectados = superficies.filter((d) => d.online).length;

  const confirmar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    if (enviando) return;
    setErro(null);
    setSucesso(null);
    setEnviando(true);
    try {
      const dispositivo = await invoke<Dispositivo>("confirmar_pareamento", { codigo });
      setSucesso(`${dispositivo.nome} foi pareado com este computador.`);
      setCodigo("");
      setPediuParear(false);
      aoMudar();
    } catch (e) {
      setErro(String(e));
    } finally {
      setEnviando(false);
    }
  };

  const permitidos = new Set(situacao.atalhosPermitidos ?? []);

  /**
   * Autoriza um aparelho a abrir programas neste computador.
   *
   * Esta permissão não vem da conta e não pode vir: o pareamento concede
   * mídia, e abrir programa é outra autoridade. Quem marca aqui está na frente
   * da máquina, que é a prova que o ADR-0004 exige. O efeito é imediato — o
   * Agente reanuncia as capacidades na sessão que já está aberta.
   */
  const alternarAtalhos = async (dispositivo: Dispositivo) => {
    const conceder = !permitidos.has(dispositivo.id);
    setErro(null);
    setSucesso(null);
    setAlterandoAtalhos(dispositivo.id);
    try {
      await invoke("definir_atalhos_permitidos", {
        id: dispositivo.id,
        permitido: conceder,
      });
      setSucesso(
        conceder
          ? `${dispositivo.nome} agora pode abrir programas neste computador.`
          : `${dispositivo.nome} não abre mais programas neste computador.`,
      );
      aoMudar();
    } catch (e) {
      setErro(String(e));
    } finally {
      setAlterandoAtalhos(null);
    }
  };

  const remover = async (dispositivo: Dispositivo) => {
    setErro(null);
    setSucesso(null);
    setRemovendo(dispositivo.id);
    try {
      await invoke("remover_dispositivo", { id: dispositivo.id });
      setARemover(null);
      setSucesso(`${dispositivo.nome} não controla mais este computador.`);
      aoMudar();
    } catch (e) {
      setErro(String(e));
    } finally {
      setRemovendo(null);
    }
  };

  return (
    <section className="tela">
      <header className="tela__topo">
        <div>
          <h1 className="tela__titulo">Aparelhos</h1>
          <Rotulo tom="atenuado">
            Celulares e tablets que controlam este computador.
          </Rotulo>
        </div>
        {superficies.length > 0 && !parear && (
          <Botao tom="acento" onClick={() => setPediuParear(true)}>
            <Icone nome="Mais" aria-hidden />
            Parear outro
          </Botao>
        )}
      </header>

      {/*
        O resumo do computador.

        Nenhum dado novo: nome, presença e contagens já vinham de `situacao` e
        estavam espalhados pela janela ou ausentes. Reunidos, eles respondem de
        uma olhada o que antes exigia contar linhas — que é a diferença entre
        uma tela que informa e uma que só lista.
      */}
      <div className="resumo">
        <span className="resumo__arte">
          <Icone nome="Computador" aria-hidden />
        </span>
        <div className="resumo__texto">
          <strong>{situacao.nomeComputador}</strong>
          <span className="resumo__linha">
            <span className={conectados > 0 ? "pulso ativo" : "pulso"} aria-hidden />
            {conectados > 0
              ? `${conectados} de ${superficies.length} ${superficies.length === 1 ? "aparelho" : "aparelhos"} conectado${conectados === 1 ? "" : "s"} agora`
              : superficies.length > 0
                ? "Nenhum aparelho conectado agora"
                : "Pronto para parear o primeiro aparelho"}
          </span>
        </div>
        <div className="resumo__numeros">
          <span className="numero">
            <strong>{superficies.length}</strong>
            <small>{superficies.length === 1 ? "pareado" : "pareados"}</small>
          </span>
          <span className="numero">
            <strong>{permitidos.size}</strong>
            <small>{permitidos.size === 1 ? "com programas" : "com programas"}</small>
          </span>
        </div>
      </div>

      {superficies.length === 0 ? (
        <p className="atenuado">Nenhum aparelho pareado ainda.</p>
      ) : (
        <ul className="aparelhos">
          {superficies.map((d) => (
            <li key={d.id} className="aparelho">
              <span className={d.online ? "aparelho__pulso ativo" : "aparelho__pulso"} aria-hidden />
              <span className="aparelho__texto">
                <span className="aparelho__nome">{d.nome}</span>
                <span className={d.online ? "etiqueta ativa" : "etiqueta"}>
                  {d.online ? "conectado agora" : "desconectado"}
                </span>
              </span>

              <label className="permissao">
                <input
                  type="checkbox"
                  checked={permitidos.has(d.id)}
                  disabled={alterandoAtalhos === d.id}
                  onChange={() => void alternarAtalhos(d)}
                />
                <span>Pode abrir programas neste computador</span>
              </label>

              <Botao
                tamanho="sm"
                tom="perigo"
                estado={removendo === d.id ? "loading" : "idle"}
                onClick={() => setARemover(d)}
              >
                Remover
              </Botao>
            </li>
          ))}
        </ul>
      )}

      {erro && !parear && (
        <p className="erro" role="alert">
          {erro}
        </p>
      )}
      {sucesso && !parear && (
        <p className="sucesso" role="status">
          {sucesso}
        </p>
      )}

      {parear && (
        <section className="bloco">
          <div className="linha">
            <h2>Parear um aparelho</h2>
            {superficies.length > 0 && (
              <Botao tamanho="sm" onClick={() => setPediuParear(false)}>
                Cancelar
              </Botao>
            )}
          </div>
          <Rotulo tom="atenuado">
            As duas formas são temporárias e confirmam que você está na frente
            deste computador.
          </Rotulo>

          <div className="seletor-modo" aria-label="Forma de pareamento">
            <button
              type="button"
              className={modo === "qr" ? "seletor-modo__opcao ativa" : "seletor-modo__opcao"}
              aria-pressed={modo === "qr"}
              onClick={() => setModo("qr")}
            >
              QR Code
            </button>
            <button
              type="button"
              className={modo === "codigo" ? "seletor-modo__opcao ativa" : "seletor-modo__opcao"}
              aria-pressed={modo === "codigo"}
              onClick={() => setModo("codigo")}
            >
              Código
            </button>
          </div>

          {modo === "qr" ? (
            <PareamentoQr
              aoMudar={aoMudar}
              aoConcluir={() => {
                if (superficies.length > 0) setPediuParear(false);
              }}
            />
          ) : (
            <form className="pareamento-codigo" onSubmit={confirmar}>
              <Rotulo tom="atenuado">
                No celular, toque em Parear este aparelho e digite aqui o código
                de seis dígitos.
              </Rotulo>
              <input
                className="codigo"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                inputMode="numeric"
                autoFocus
                aria-label="Código de pareamento"
              />
              {erro && (
                <p className="erro" role="alert">
                  {erro}
                </p>
              )}
              {sucesso && (
                <p className="sucesso" role="status">
                  {sucesso}
                </p>
              )}
              <Botao
                type="submit"
                tom="acento"
                tamanho="lg"
                estado={enviando ? "loading" : codigo.length === 6 ? "idle" : "disabled"}
              >
                {enviando ? "Confirmando…" : "Confirmar pareamento"}
              </Botao>
            </form>
          )}
        </section>
      )}

      <Modal
        aberto={aRemover !== null}
        titulo="Remover este aparelho?"
        descricao={
          aRemover
            ? `${aRemover.nome} deixa de controlar este computador. Para voltar, será preciso parear de novo.`
            : undefined
        }
        aoFechar={() => setARemover(null)}
        acoes={
          <>
            <Botao onClick={() => setARemover(null)}>Cancelar</Botao>
            <Botao tom="perigo" onClick={() => aRemover && void remover(aRemover)}>
              Remover
            </Botao>
          </>
        }
      />
    </section>
  );
}

function PareamentoQr({
  aoMudar,
  aoConcluir,
}: {
  aoMudar: () => void;
  aoConcluir: () => void;
}) {
  const [convite, setConvite] = useState<ConviteQr | null>(null);
  const [restante, setRestante] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const aoConcluirRef = useRef(aoConcluir);
  aoConcluirRef.current = aoConcluir;

  const criar = useCallback(async () => {
    setConvite(null);
    setErro(null);
    setSucesso(null);
    try {
      setConvite(await invoke<ConviteQr>("criar_convite_qr"));
    } catch {
      setErro("Não foi possível criar o QR Code agora. Use o código ou tente novamente.");
    }
  }, []);

  useEffect(() => {
    void criar();
  }, [criar]);

  useEffect(() => {
    if (!convite) return;
    const atualizar = () =>
      setRestante(
        Math.max(0, Math.ceil((new Date(convite.expiraEm).getTime() - Date.now()) / 1_000)),
      );
    atualizar();
    const timer = window.setInterval(atualizar, 1_000);
    return () => window.clearInterval(timer);
  }, [convite]);

  /*
   * A consulta acompanha o convite, e **não** o contador.
   *
   * Com `restante` nas dependências, este efeito era desmontado e remontado a
   * cada segundo — e um intervalo de dois segundos destruído a cada um nunca
   * dispara. O Agente não chegava a perguntar se o convite tinha sido aceito.
   *
   * O estrago passava disso: esta consulta é o único momento em que o aparelho
   * entra na raiz de confiança local. Sem ela o celular pareava na conta e
   * seguia desconhecido aqui, e a oferta WebRTC chegava de uma origem sem par
   * confiável — do outro lado, uma conexão que nunca completa.
   */
  useEffect(() => {
    if (!convite) return;
    let consultando = false;
    const verificar = async () => {
      if (new Date(convite.expiraEm).getTime() <= Date.now()) return;
      if (consultando) return;
      consultando = true;
      try {
        const resultado = await invoke<SituacaoConviteQr>("consultar_convite_qr", {
          conviteId: convite.conviteId,
        });
        if (resultado.situacao === "confirmado" && resultado.dispositivo) {
          setSucesso(`${resultado.dispositivo.nome} foi conectado com segurança.`);
          setConvite(null);
          aoMudar();
          window.setTimeout(() => aoConcluirRef.current(), 2_500);
        } else if (resultado.situacao === "expirado") {
          setRestante(0);
        }
      } catch {
        // Uma consulta pontual não invalida um QR ainda dentro do prazo.
      } finally {
        consultando = false;
      }
    };
    void verificar();
    const timer = window.setInterval(() => void verificar(), 2_000);
    return () => window.clearInterval(timer);
  }, [convite, aoMudar]);

  if (sucesso) {
    return (
      <p className="sucesso sucesso--celebra" role="status">
        <Icone nome="Verificado" aria-hidden />
        {sucesso}
      </p>
    );
  }

  return (
    <div className="pareamento-qr">
      <Rotulo tom="atenuado">
        Aponte a câmera do celular para o QR Code e abra o link do SLATE.
      </Rotulo>
      {convite ? (
        <>
          <div className="qr-moldura">
            <QRCodeSVG
              value={convite.url}
              size={200}
              level="M"
              marginSize={2}
              /*
               * Preto e branco fixos, e não tokens: um QR Code precisa de
               * contraste máximo para a câmera decodificar, e acompanhar o
               * tema deixaria o código cinza sobre cinza no claro. A moldura
               * em volta é que responde ao tema.
               */
              bgColor="#ffffff"
              fgColor="#000000"
              title="QR Code para parear com este computador"
            />
          </div>
          <p className="qr-prazo" role="timer">
            {restante > 0
              ? `Expira em ${Math.floor(restante / 60)}:${String(restante % 60).padStart(2, "0")}`
              : "QR Code expirado"}
          </p>
        </>
      ) : !erro ? (
        <p className="atenuado" aria-busy="true">
          Preparando QR Code…
        </p>
      ) : null}
      {erro && (
        <p className="erro" role="alert">
          {erro}
        </p>
      )}
      {(!convite || restante === 0) && (
        <Botao onClick={() => void criar()}>Gerar novo QR Code</Botao>
      )}
    </div>
  );
}
