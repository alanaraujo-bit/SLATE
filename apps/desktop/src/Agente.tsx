import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
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
}

interface Situacao {
  conectado: boolean;
  usuario: Usuario | null;
  nomeComputador: string;
  chavePublica: string;
  dispositivos: Dispositivo[];
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

  const superficies = situacao.dispositivos.filter((d) => d.papel === "surface");

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

      <form className="bloco" onSubmit={confirmar}>
        <h2>Parear um aparelho</h2>
        <p className="atenuado">
          Abra o SLATE no celular, toque em <strong>Parear este aparelho</strong> e
          digite aqui o código que aparecer.
        </p>

        <input
          className="codigo"
          value={codigo}
          onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="000000"
          inputMode="numeric"
          // Autofoco aqui porque digitar o código é a única coisa que se faz
          // nesta tela — a pessoa chega com o celular na mão e o código
          // correndo contra o tempo.
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

      <section className="bloco">
        <h2>Aparelhos pareados</h2>
        {superficies.length === 0 ? (
          <p className="atenuado">Nenhum aparelho pareado ainda.</p>
        ) : (
          <ul className="lista">
            {superficies.map((d) => (
              <li key={d.id}>
                <span>{d.nome}</span>
                <span className="atenuado pequeno">{d.situacao}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
