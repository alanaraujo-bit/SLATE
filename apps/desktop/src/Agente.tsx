import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Icone, Palco, PASSO_PALCO, Rotulo, usarInclinacao, type NomeIcone } from "@slate/design-system";
import { TelaAparelhos } from "./telas/aparelhos";
import { TelaProgramas } from "./telas/programas";
import { TelaPaineis } from "./telas/paineis";
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

type Aba = "aparelhos" | "paineis" | "programas" | "ajustes";

const ABAS: readonly { id: Aba; rotulo: string; icone: NomeIcone }[] = [
  { id: "aparelhos", rotulo: "Aparelhos", icone: "Celular" },
  { id: "paineis", rotulo: "Painéis", icone: "Camada" },
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
        {aba === "paineis" && <TelaPaineis />}
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

/**
 * Marca do Google, em cores fixas.
 *
 * Fica fora do conjunto de ícones do design system de propósito: aquele é
 * `currentColor` porque cada ícone precisa valer em qualquer cor de controle,
 * e uma marca de terceiro não pode mudar de cor — ela é reconhecida pela
 * própria paleta.
 */
function LogoGoogle() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.9v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.9A9 9 0 0 0 0 9c0 1.45.35 2.83.9 4.03z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C12.94.9 10.9 0 9 0A9 9 0 0 0 .9 4.97L3.95 7.3C4.66 5.17 6.65 3.58 9 3.58z"
      />
    </svg>
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

  /*
   * Em que ponto do formulário a pessoa está: 0 em repouso, 1 no e-mail, 2 na
   * senha, 3 enviando. É o único valor que o palco recebe.
   *
   * Deriva do campo em foco, e nunca do que foi digitado. Um palco que
   * reagisse a cada caractere exporia o tamanho da senha para quem olhasse a
   * tela — barato de evitar agora, invisível se ficar errado.
   */
  const [passo, setPasso] = useState<number>(PASSO_PALCO.repouso);

  // A placa acompanha o ponteiro pela área inteira da vitrine, e não só pelos
  // pixels que ela ocupa.
  const inclinacao = usarInclinacao();

  const enviar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    if (enviando) return;
    setErro(null);
    setEnviando(true);
    setPasso(PASSO_PALCO.entrando);
    try {
      await invoke("entrar", { email, senha });
      aoEntrar();
    } catch (e) {
      // O Rust já devolve mensagens em português e sem jargão.
      setErro(String(e));
      // A superfície recua junto com o erro: deixá-la acesa depois de a entrada
      // falhar seria a tela comemorando o que não aconteceu.
      setPasso(PASSO_PALCO.repouso);
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
      <div className="portal__brilho portal__brilho--violeta" aria-hidden="true" />
      <div className="portal__brilho portal__brilho--ciano" aria-hidden="true" />

      <div className="portal__casco">
        <aside className="portal__vitrine" {...inclinacao}>
          <div className="portal__marca">
            <span className="marca-simbolo" aria-hidden="true">
              <i /><i /><i /><i />
            </span>
            <span className="marca marca--grande">SLATE</span>
            <span className="portal__edicao">Desktop</span>
          </div>

          <div className="portal__palco">
            <Palco passo={passo} />
            <span className="portal__estado">
              <i aria-hidden="true" />
              Pronto para conectar
            </span>
          </div>

          <div className="portal__texto">
            <span className="portal__sobretitulo">Controle sem interromper</span>
            <h1 className="portal__promessa">Seu computador na ponta dos dedos.</h1>
            <p className="portal__descricao">
              Transforme seu celular em uma superfície de controle privada,
              instantânea e feita para o seu fluxo.
            </p>
          </div>

          <ul className="portal__recursos">
            <li>
              <span className="chip chip--violet"><Icone nome="Play" aria-hidden /></span>
              <span><strong>Controle instantâneo</strong> Mídia e volume sem trocar de janela.</span>
            </li>
            <li>
              <span className="chip chip--cyan"><Icone nome="Grade" aria-hidden /></span>
              <span><strong>Do seu jeito</strong> Seus programas, jogos e comandos.</span>
            </li>
            <li>
              <span className="chip chip--green"><Icone nome="Escudo" aria-hidden /></span>
              <span><strong>Pareamento privado</strong> Autorizado neste computador.</span>
            </li>
          </ul>
        </aside>

        <form className="entrada" onSubmit={enviar}>
          <div className="entrada__marca-compacta">
            <span className="marca-simbolo" aria-hidden="true"><i /><i /><i /><i /></span>
            <span className="marca">SLATE</span>
          </div>

          <div className="entrada__status">
            <Icone nome="Escudo" aria-hidden />
            Acesso protegido
          </div>

          <div className="entrada__cabecalho">
            <h1>Boas-vindas de volta</h1>
            <p className="atenuado">Entre com a mesma conta usada no seu celular.</p>
          </div>

        <label className="campo">
          <span>E-mail</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onFocus={() => !enviando && setPasso(PASSO_PALCO.email)}
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
            onFocus={() => !enviando && setPasso(PASSO_PALCO.senha)}
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

          <button type="submit" className="botao principal botao--largo entrada__enviar" disabled={enviando}>
            <span>{enviando ? "Entrando…" : "Entrar"}</span>
            {!enviando && <Icone nome="Avancar" aria-hidden />}
          </button>

        <div className="divisor">
          <span>ou</span>
        </div>

        {/*
          Sem OAuth real ainda (ADR-0005): entrar com Google exige credenciais
          de operador que ainda não existem. O botão já mostra a forma final
          para quando isso chegar, e o selo evita prometer o que a tela ainda
          não faz.
        */}
        <button
          type="button"
          className="botao botao--largo botao-google"
          disabled
          title="Em breve — depende de credenciais do Google ainda não configuradas"
        >
          <LogoGoogle />
          Continuar com o Google
          <span className="selo-em-breve">Em breve</span>
        </button>

          <div className="entrada__rodape">
            <Icone nome="Escudo" aria-hidden />
            <p>Sua senha é processada localmente e nunca fica exposta nesta janela.</p>
          </div>
        </form>
      </div>
    </div>
  );
}
