import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Botao, Icone, Rotulo } from "@slate/design-system";
import { Modal } from "../modal";

/**
 * Cadastro dos programas que o celular pode abrir.
 *
 * **Definir acontece aqui, e não no celular.** O ADR-0004 põe `action.define`
 * fora do alcance de um aparelho: escolher qual executável um atalho abre é
 * ato de quem está na frente da máquina, com o seletor de arquivo do próprio
 * Windows. O celular manda `programa.<id>`; o caminho sai da lista em disco e
 * nunca atravessa o canal.
 */

export interface Atalho {
  id: string;
  nome: string;
  caminho: string;
  cor: string;
  icone?: string;
}

/** As mesmas doze de `atalhos.rs` e do protocolo. Lista fechada dos dois lados. */
const CORES = [
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "teal",
  "cyan",
  "blue",
  "indigo",
  "violet",
  "pink",
] as const;

/**
 * Deriva um nome a partir do arquivo escolhido.
 *
 * O comando em Rust recusa nome vazio e não inventa nenhum — de propósito, para
 * não gravar "novo atalho" no lugar de uma escolha. Quem sugere é a interface,
 * e o palpite certo é o nome do arquivo sem a extensão: quem escolhe
 * `Cyberpunk2077.exe` espera ver "Cyberpunk2077", não o caminho inteiro.
 */
export function nomeSugerido(caminho: string): string {
  const arquivo = caminho.split(/[\\/]/).pop() ?? caminho;
  return arquivo.replace(/\.(exe|lnk|bat|cmd|url)$/i, "").slice(0, 40) || "Programa";
}

export function TelaProgramas({ podeUsar }: { podeUsar: boolean }) {
  const [atalhos, setAtalhos] = useState<Atalho[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [emEdicao, setEmEdicao] = useState<Atalho | null>(null);
  const [aRemover, setARemover] = useState<Atalho | null>(null);
  const [adicionando, setAdicionando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setAtalhos(await invoke<Atalho[]>("listar_atalhos"));
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

  const adicionar = async () => {
    if (adicionando) return;
    setErro(null);
    setAdicionando(true);
    try {
      const caminho = await invoke<string | null>("escolher_programa");
      // Cancelar o seletor é uma decisão, não uma falha: nada acontece e
      // nenhuma mensagem de erro aparece.
      if (!caminho) return;
      await invoke("criar_atalho", {
        caminho,
        nome: nomeSugerido(caminho),
        cor: CORES[atalhos.length % CORES.length],
      });
      await carregar();
    } catch (e) {
      setErro(String(e));
    } finally {
      setAdicionando(false);
    }
  };

  const salvar = async (atalho: Atalho, nome: string, cor: string) => {
    setErro(null);
    try {
      await invoke("renomear_atalho", { id: atalho.id, nome, cor });
      setEmEdicao(null);
      await carregar();
    } catch (e) {
      setErro(String(e));
    }
  };

  const remover = async (atalho: Atalho) => {
    setErro(null);
    try {
      await invoke("remover_atalho", { id: atalho.id });
      setARemover(null);
      await carregar();
    } catch (e) {
      setErro(String(e));
    }
  };

  return (
    <section className="tela">
      <header className="tela__topo">
        <div>
          <h1 className="tela__titulo">Programas</h1>
          <Rotulo tom="atenuado">
            Escolha os programas e jogos que o celular pode abrir daqui.
          </Rotulo>
        </div>
        <Botao
          tom="acento"
          estado={adicionando ? "loading" : "idle"}
          onClick={() => void adicionar()}
        >
          <Icone nome="Mais" aria-hidden />
          Adicionar programa
        </Botao>
      </header>

      {!podeUsar && atalhos.length > 0 && (
        <p className="aviso-linha" role="status">
          <Icone nome="Alerta" aria-hidden />
          Nenhum aparelho pode abrir programas ainda. Marque a permissão em
          Aparelhos para estes atalhos aparecerem no celular.
        </p>
      )}

      {erro && (
        <p className="erro" role="alert">
          {erro}
        </p>
      )}

      {carregando ? (
        <p className="atenuado" aria-busy="true">
          Carregando…
        </p>
      ) : atalhos.length === 0 ? (
        <div className="vazio">
          <Icone nome="Grade" aria-hidden />
          <h2>Nenhum programa cadastrado</h2>
          <p>
            O ícone de cada atalho vem do próprio programa, e o celular recebe
            só o nome e a cor — nunca o caminho do arquivo neste computador.
          </p>
          <Botao
            tom="acento"
            estado={adicionando ? "loading" : "idle"}
            onClick={() => void adicionar()}
          >
            Escolher o primeiro
          </Botao>
        </div>
      ) : (
        <ul className="programas">
          {atalhos.map((atalho) => (
            <li
              key={atalho.id}
              className="programa"
              style={{ ["--tom" as string]: `var(--s-control-${atalho.cor})` }}
            >
              <span className="programa__arte">
                {atalho.icone ? (
                  <img src={atalho.icone} alt="" aria-hidden />
                ) : (
                  <Icone nome="Monitor" aria-hidden />
                )}
              </span>
              <span className="programa__texto">
                <span className="programa__nome">{atalho.nome}</span>
                {/* O caminho aparece aqui, na máquina que já o conhece — é o
                    que permite distinguir dois jogos de mesmo nome. Ele nunca
                    sai deste computador. */}
                <span className="programa__caminho" title={atalho.caminho}>
                  {atalho.caminho}
                </span>
              </span>
              <span className="programa__acoes">
                <Botao tamanho="sm" onClick={() => setEmEdicao(atalho)}>
                  Editar
                </Botao>
                <Botao tamanho="sm" tom="perigo" onClick={() => setARemover(atalho)}>
                  Remover
                </Botao>
              </span>
            </li>
          ))}
        </ul>
      )}

      {emEdicao && (
        <ModalEdicao
          atalho={emEdicao}
          aoSalvar={(nome, cor) => void salvar(emEdicao, nome, cor)}
          aoFechar={() => setEmEdicao(null)}
        />
      )}

      <Modal
        aberto={aRemover !== null}
        titulo="Remover este atalho?"
        descricao={
          aRemover
            ? `"${aRemover.nome}" deixa de aparecer no celular. O programa continua instalado neste computador.`
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

function ModalEdicao({
  atalho,
  aoSalvar,
  aoFechar,
}: {
  atalho: Atalho;
  aoSalvar: (nome: string, cor: string) => void;
  aoFechar: () => void;
}) {
  const [nome, setNome] = useState(atalho.nome);
  const [cor, setCor] = useState(atalho.cor);

  return (
    <Modal
      aberto
      titulo="Editar atalho"
      aoFechar={aoFechar}
      acoes={
        <>
          <Botao onClick={aoFechar}>Cancelar</Botao>
          <Botao
            tom="acento"
            estado={nome.trim() ? "idle" : "disabled"}
            onClick={() => aoSalvar(nome, cor)}
          >
            Salvar
          </Botao>
        </>
      }
    >
      <label className="campo">
        <span>Nome</span>
        <input
          value={nome}
          maxLength={40}
          onChange={(e) => setNome(e.target.value)}
          autoFocus
        />
      </label>

      <fieldset className="cores">
        <legend>Cor</legend>
        {CORES.map((disponivel) => (
          <button
            key={disponivel}
            type="button"
            className={`cor${cor === disponivel ? " cor--ativa" : ""}`}
            style={{ ["--tom" as string]: `var(--s-control-${disponivel})` }}
            aria-label={disponivel}
            aria-pressed={cor === disponivel}
            onClick={() => setCor(disponivel)}
          />
        ))}
      </fieldset>
    </Modal>
  );
}
