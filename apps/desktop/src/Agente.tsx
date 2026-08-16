import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { QRCodeSVG } from "qrcode.react";
import { Atualizador } from "./atualizador";
import { InicioAutomatico } from "./inicio-automatico";

interface Usuario {
  id: string;
  email: string;
  nome: string | null;
}

interface Dispositivo {
  id: string;
  nome: string;
  papel: string;
  situacao: string;
  online?: boolean;
}

interface Situacao {
  conectado: boolean;
  usuario: Usuario | null;
  nomeComputador: string;
  chavePublica: string;
  dispositivos: Dispositivo[];
  /** IDs autorizados a abrir programas neste computador. */
  atalhosPermitidos?: string[];
}

interface ConviteQr {
  conviteId: string;
  expiraEm: string;
  url: string;
}

interface SituacaoConviteQr {
  situacao: "pendente" | "expirado" | "confirmado";
  dispositivo?: Dispositivo;
}

/**
 * Interface do Agente.
 *
 * Ela é só apresentação: a chave privada e o cookie de sessão vivem no
 * processo em Rust, e nada aqui os alcança. Toda operação que toca segredo
 * acontece do outro lado.
 */
export function Agente() {
  const [situacao, setSituacao] = useState<Situacao | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      setSituacao(await invoke<Situacao>("situacao"));
      setErro(null);
    } catch (e) {
      setErro(String(e));
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (carregando) {
    return (
      <div className="agente">
        <Cabecalho />
        <div className="centro">
          <p className="atenuado">Carregando…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="agente">
      <Cabecalho />
      {situacao?.conectado ? (
        <Pareamento situacao={situacao} aoMudar={carregar} />
      ) : (
        <Entrada aoEntrar={carregar} erroExterno={erro} />
      )}
      <InicioAutomatico />
      <Atualizador />
    </div>
  );
}

function Cabecalho() {
  return (
    <header className="cabecalho">
      <span className="marca">SLATE</span>
      <span className="atenuado pequeno">Agente</span>
    </header>
  );
}

function Entrada({
  aoEntrar,
  erroExterno,
}: {
  aoEntrar: () => void;
  erroExterno: string | null;
}) {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const enviar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    if (enviando) return;

    setErro(null);
    setEnviando(true);

    try {
      await invoke("entrar", { email, senha });
      aoEntrar();
    } catch (e) {
      // O Rust já devolve mensagens em português e sem jargão.
      setErro(String(e));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <form className="conteudo" onSubmit={enviar}>
      <h1>Entrar na sua conta</h1>
      <p className="atenuado">
        Use a mesma conta do SLATE no celular. É ela que liga os dois.
      </p>

      <label className="campo">
        <span>E-mail</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          autoCapitalize="none"
          required
        />
      </label>

      <label className="campo">
        <span>Senha</span>
        <input
          type="password"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          autoComplete="current-password"
          required
        />
      </label>

      {(erro || erroExterno) && (
        <p className="erro" role="alert">
          {erro ?? erroExterno}
        </p>
      )}

      <button type="submit" className="botao principal" disabled={enviando}>
        {enviando ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}

function Pareamento({
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
  const [removendo, setRemovendo] = useState<string | null>(null);
  const [alterandoAtalhos, setAlterandoAtalhos] = useState<string | null>(null);

  const superficies = situacao.dispositivos.filter(
    (d) => d.papel === "surface" && d.situacao !== "revogado",
  );

  // Quem ainda não pareou nada precisa parear: essa é a tela. Quem já tem
  // aparelho não precisa de um QR Code na frente toda vez que abre o programa
  // — ele só aparece quando a pessoa pede outro aparelho.
  const [parear, setParear] = useState(superficies.length === 0);

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
      setParear(false);
      aoMudar();
    } catch (e) {
      setErro(String(e));
    } finally {
      setEnviando(false);
    }
  };

  const sair = async () => {
    await invoke("sair");
    aoMudar();
  };

  const permitidos = new Set(situacao.atalhosPermitidos ?? []);

  /**
   * Autoriza um aparelho a abrir programas neste computador.
   *
   * Esta permissão não vem da conta e não pode vir: o pareamento concede
   * mídia, e abrir programa é outra autoridade. Quem marca aqui está na frente
   * da máquina, que é a prova que o ADR-0004 exige. Vale para este computador
   * só — o mesmo celular continua sem o poder nos outros.
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
      setSucesso(`${dispositivo.nome} não controla mais este computador.`);
      aoMudar();
    } catch (e) {
      setErro(String(e));
    } finally {
      setRemovendo(null);
    }
  };

  return (
    <div className="conteudo">
      <div className="linha">
        <div>
          <h1>{situacao.nomeComputador}</h1>
          <p className="atenuado pequeno">{situacao.usuario?.email}</p>
        </div>
        <button className="botao discreto" onClick={sair}>
          Sair
        </button>
      </div>

      <section className="bloco">
        <div className="linha">
          <h2>Aparelhos pareados</h2>
          {superficies.length > 0 && !parear && (
            <button type="button" className="botao discreto" onClick={() => setParear(true)}>
              Parear outro
            </button>
          )}
        </div>

        {superficies.length === 0 ? (
          <p className="atenuado">Nenhum aparelho pareado ainda.</p>
        ) : (
          <ul className="lista">
            {superficies.map((d) => (
              <li key={d.id}>
                <span>
                  <span className="lista__nome">{d.nome}</span>
                  <span className={d.online ? "etiqueta ativa" : "etiqueta"}>
                    {d.online ? "conectado agora" : "desconectado"}
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
                </span>
                <button
                  type="button"
                  className="botao discreto"
                  disabled={removendo === d.id}
                  onClick={() => void remover(d)}
                >
                  {removendo === d.id ? "Removendo…" : "Remover"}
                </button>
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
      </section>

      {parear && (
      <section className="bloco pareamento-escolha">
        <div className="linha">
          <h2>Parear um aparelho</h2>
          {superficies.length > 0 && (
            <button type="button" className="botao discreto" onClick={() => setParear(false)}>
              Cancelar
            </button>
          )}
        </div>
        <p className="atenuado">
          Escolha a forma mais confortável. As duas opções são temporárias e
          confirmam que você está na frente deste computador.
        </p>

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
              if (superficies.length > 0) setParear(false);
            }}
          />
        ) : (
          <form className="pareamento-codigo" onSubmit={confirmar}>
            <p className="atenuado">
              No celular, toque em <strong>Parear este aparelho</strong> e digite
              aqui o código de seis dígitos.
            </p>

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

            <button
              type="submit"
              className="botao principal"
              disabled={enviando || codigo.length !== 6}
            >
              {enviando ? "Confirmando…" : "Confirmar pareamento"}
            </button>
          </form>
        )}
      </section>
      )}
    </div>
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
  // Guardada numa referência para que a consulta do convite não reinicie a
  // cada quadro só porque o pai criou outra função com o mesmo corpo.
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

  useEffect(() => {
    if (!convite || restante === 0) return;
    let consultando = false;
    const verificar = async () => {
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
          // Deixa a confirmação visível por um instante antes de voltar para a
          // lista: fechar no mesmo quadro em que o pareamento deu certo faz
          // parecer que a tela piscou sem motivo.
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
    const timer = window.setInterval(() => void verificar(), 2_000);
    return () => window.clearInterval(timer);
  }, [convite, restante, aoMudar]);

  if (sucesso) return <p className="sucesso" role="status">{sucesso}</p>;

  return (
    <div className="pareamento-qr">
      <p className="atenuado">
        Aponte a câmera do celular para o QR Code e abra o link do SLATE.
      </p>
      {convite ? (
        <>
          <div className="qr-moldura">
            <QRCodeSVG
              value={convite.url}
              size={212}
              level="M"
              marginSize={2}
              bgColor="#ffffff"
              fgColor="#07111f"
              title="QR Code para parear com este computador"
            />
            <span>SLATE</span>
          </div>
          <p className="qr-prazo" role="timer">
            {restante > 0
              ? `Expira em ${Math.floor(restante / 60)}:${String(restante % 60).padStart(2, "0")}`
              : "QR Code expirado"}
          </p>
        </>
      ) : !erro ? (
        <p className="atenuado" aria-busy="true">Preparando QR Code…</p>
      ) : null}
      {erro && <p className="erro" role="alert">{erro}</p>}
      {(!convite || restante === 0) && (
        <button type="button" className="botao" onClick={() => void criar()}>
          Gerar novo QR Code
        </button>
      )}
    </div>
  );
}
