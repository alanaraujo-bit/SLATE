import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Icone, Rotulo } from "@slate/design-system";
import { TelaAparelhos } from "./telas/aparelhos";
import { TelaProgramas } from "./telas/programas";
import { TelaAjustes } from "./telas/ajustes";
import { useTema } from "./tema";
import type { Situacao } from "./tipos";

/**
 * Interface do Agente.
 *
 * Ela é só apresentação: a chave privada e o cookie de sessão vivem no
 * processo em Rust, e nada aqui os alcança. Toda operação que toca segredo
 * acontece do outro lado.
 *
 * A janela é dividida em telas porque as tarefas são de ritmos diferentes:
 * parear é raro, cadastrar programa é ocasional, e ajustes se mexe uma vez e
 * esquece. Amontoar tudo numa rolagem só fazia o que importa naquele momento
 * competir com o que não importa nunca mais.
 */

type Aba = "aparelhos" | "programas" | "ajustes";

const ABAS: readonly { id: Aba; rotulo: string; icone: "Celular" | "Grade" | "Configuracoes" }[] = [
  { id: "aparelhos", rotulo: "Aparelhos", icone: "Celular" },
  { id: "programas", rotulo: "Programas", icone: "Grade" },
  { id: "ajustes", rotulo: "Ajustes", icone: "Configuracoes" },
];

export function Agente() {
  const [situacao, setSituacao] = useState<Situacao | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aba, setAba] = useState<Aba>("aparelhos");
  const [tema, escolherTema] = useTema();

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
      <div className="agente agente--centro">
        <div className="carregando" aria-busy="true">
          <span className="marca marca--grande">SLATE</span>
          <Rotulo tom="atenuado">Carregando…</Rotulo>
        </div>
      </div>
    );
  }

  // Sem envoltório: a entrada ocupa a janela inteira, com as duas metades.
  if (!situacao?.conectado) {
    return <Entrada aoEntrar={carregar} erroExterno={erro} />;
  }

  const conectados = situacao.dispositivos.filter(
    (d) => d.papel === "surface" && d.situacao !== "revogado" && d.online,
  ).length;

  return (
    <div className="agente">
      <nav className="lateral" aria-label="Seções">
        <div className="lateral__marca">
          <span className="marca">SLATE</span>
          <span className="lateral__maquina">{situacao.nomeComputador}</span>
        </div>

        <ul className="lateral__abas">
          {ABAS.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={`lateral__aba${aba === item.id ? " ativa" : ""}`}
                aria-current={aba === item.id ? "page" : undefined}
                onClick={() => setAba(item.id)}
              >
                <Icone nome={item.icone} aria-hidden />
                {item.rotulo}
              </button>
            </li>
          ))}
        </ul>

        {/*
          O rodapé responde a única pergunta que se faz olhando para esta
          janela de longe: tem alguém controlando este computador agora?
        */}
        <div className="lateral__estado">
          <span className={conectados > 0 ? "pulso ativo" : "pulso"} aria-hidden />
          <Rotulo tamanho="2xs" tom="sutil">
            {conectados > 0
              ? `${conectados} ${conectados === 1 ? "aparelho conectado" : "aparelhos conectados"}`
              : "Nenhum aparelho conectado"}
          </Rotulo>
        </div>
      </nav>

      <main className="conteudo">
        {aba === "aparelhos" && (
          <TelaAparelhos situacao={situacao} aoMudar={carregar} />
        )}
        {aba === "programas" && (
          <TelaProgramas podeUsar={(situacao.atalhosPermitidos ?? []).length > 0} />
        )}
        {aba === "ajustes" && (
          <TelaAjustes
            situacao={situacao}
            tema={tema}
            aoEscolherTema={escolherTema}
            aoSair={carregar}
          />
        )}
      </main>
    </div>
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
    /*
     * Duas metades: à esquerda o que o produto é, à direita o que a pessoa faz.
     *
     * A da esquerda não é enfeite. Esta é a primeira tela de um programa que
     * alguém acabou de instalar, e ela responde "o que isto faz?" enquanto o
     * formulário responde "o que eu faço agora?". Numa janela estreita a
     * apresentação sai de cena e o formulário fica — quem já conhece o produto
     * não precisa ser apresentado a ele toda vez.
     */
    <div className="portal">
      <aside className="portal__vitrine" aria-hidden="true">
        <span className="marca marca--grande">SLATE</span>
        <p className="portal__promessa">
          Seu celular vira o painel de controle do computador.
        </p>
        <ul className="portal__recursos">
          <li>
            <span className="chip chip--violet">
              <Icone nome="Play" aria-hidden />
            </span>
            Mídia e volume, sem sair do jogo
          </li>
          <li>
            <span className="chip chip--cyan">
              <Icone nome="Grade" aria-hidden />
            </span>
            Programas e jogos que você escolher
          </li>
          <li>
            <span className="chip chip--green">
              <Icone nome="Verificado" aria-hidden />
            </span>
            Pareamento confirmado neste computador
          </li>
        </ul>
      </aside>

      <form className="entrada" onSubmit={enviar}>
        <div className="entrada__cabecalho">
          <h1>Entrar na sua conta</h1>
          <p className="atenuado">
            Use a mesma conta do SLATE no celular. É ela que liga os dois.
          </p>
        </div>

        <label className="campo">
          <span>E-mail</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            autoCapitalize="none"
            placeholder="voce@exemplo.com"
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
            placeholder="Sua senha"
            required
          />
        </label>

        {(erro || erroExterno) && (
          <p className="erro" role="alert">
            {erro ?? erroExterno}
          </p>
        )}

        <button type="submit" className="botao principal botao--largo" disabled={enviando}>
          {enviando ? "Entrando…" : "Entrar"}
        </button>

        <p className="entrada__rodape">
          A senha vai direto para o processo do SLATE neste computador. Esta
          janela nunca vê sua chave nem seu cookie de sessão.
        </p>
      </form>
    </div>
  );
}
