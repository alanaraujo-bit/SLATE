import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Botao, Icone, Marca, Rotulo, type NomeIcone, type NomeMarca } from "@slate/design-system";
import type { CorAtalho, ItemDePerfilDeck, PerfilDeDeck } from "@slate/protocol";
import type { Atalho } from "./programas";
import { Modal } from "../modal";

interface ConfiguracaoDeck {
  atalhos: Atalho[];
  perfis: PerfilDeDeck[];
  perfilPadraoId: string;
}

interface AcaoCatalogo {
  actionId: string;
  nome: string;
  grupo: "Mídia" | "Volume" | "Serviços" | "Programas";
  icone: NomeIcone;
  marca?: NomeMarca;
  /**
   * PNG extraído do próprio executável, quando existe.
   *
   * A tela de Programas já mostrava o ícone de verdade e só o editor não —
   * então o mesmo jogo aparecia com a cara dele numa aba e como um monitor
   * genérico na outra, que é justamente onde a pessoa precisa reconhecê-lo de
   * relance para montar o painel.
   */
  arte?: string;
}

const ACOES_FIXAS: readonly AcaoCatalogo[] = [
  { actionId: "midia.reproduzir-pausar", nome: "Reproduzir / pausar", grupo: "Mídia", icone: "Play" },
  { actionId: "midia.anterior", nome: "Faixa anterior", grupo: "Mídia", icone: "Anterior" },
  { actionId: "midia.proxima", nome: "Próxima faixa", grupo: "Mídia", icone: "Proximo" },
  { actionId: "midia.parar", nome: "Parar", grupo: "Mídia", icone: "Parar" },
  { actionId: "volume.diminuir", nome: "Menos volume", grupo: "Volume", icone: "Volume" },
  { actionId: "volume.mudo", nome: "Mudo", grupo: "Volume", icone: "Mudo" },
  { actionId: "volume.aumentar", nome: "Mais volume", grupo: "Volume", icone: "Volume" },
  { actionId: "atalho.youtube", nome: "YouTube", grupo: "Serviços", icone: "Monitor", marca: "youtube" },
  { actionId: "atalho.twitch", nome: "Twitch", grupo: "Serviços", icone: "Monitor", marca: "twitch" },
  { actionId: "atalho.netflix", nome: "Netflix", grupo: "Serviços", icone: "Monitor", marca: "netflix" },
  { actionId: "atalho.prime", nome: "Prime Video", grupo: "Serviços", icone: "Monitor", marca: "prime" },
  { actionId: "atalho.disney", nome: "Disney+", grupo: "Serviços", icone: "Monitor", marca: "disney" },
  { actionId: "atalho.spotify", nome: "Spotify", grupo: "Serviços", icone: "Monitor", marca: "spotify" },
];

const CORES: readonly CorAtalho[] = [
  "red", "orange", "amber", "yellow", "lime", "green",
  "teal", "cyan", "blue", "indigo", "violet", "pink",
];

export function TelaPaineis() {
  const [configuracao, setConfiguracao] = useState<ConfiguracaoDeck | null>(null);
  const [perfilId, setPerfilId] = useState("");
  const [pagina, setPagina] = useState(0);
  const [orientacao, setOrientacao] = useState<"retrato" | "paisagem">("retrato");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [aRemover, setARemover] = useState<PerfilDeDeck | null>(null);

  const carregar = useCallback(async () => {
    try {
      const dados = await invoke<ConfiguracaoDeck>("listar_configuracao_deck");
      setConfiguracao(dados);
      setPerfilId((atual) =>
        dados.perfis.some((perfil) => perfil.id === atual)
          ? atual
          : dados.perfilPadraoId || dados.perfis[0]?.id || "",
      );
      setErro(null);
    } catch (e) {
      setErro(String(e));
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  useEffect(() => setPagina(0), [perfilId]);

  const perfil = configuracao?.perfis.find((item) => item.id === perfilId);
  const catalogo = useMemo<AcaoCatalogo[]>(() => {
    const programas = (configuracao?.atalhos ?? []).map((atalho) => ({
      actionId: `programa.${atalho.id}`,
      nome: atalho.nome,
      grupo: "Programas" as const,
      icone: "Monitor" as const,
      arte: atalho.icone,
    }));
    return [...ACOES_FIXAS, ...programas];
  }, [configuracao?.atalhos]);
  const catalogoPorId = useMemo(
    () => new Map(catalogo.map((acao) => [acao.actionId, acao] as const)),
    [catalogo],
  );

  const salvar = async (proximo: PerfilDeDeck) => {
    if (!configuracao || salvando) return;
    const anterior = configuracao;
    setConfiguracao({
      ...configuracao,
      perfis: configuracao.perfis.map((item) => item.id === proximo.id ? proximo : item),
    });
    setSalvando(true);
    setErro(null);
    try {
      await invoke("salvar_perfil", { perfil: proximo });
      await carregar();
    } catch (e) {
      setConfiguracao(anterior);
      setErro(String(e));
    } finally {
      setSalvando(false);
    }
  };

  const criar = async () => {
    setSalvando(true);
    try {
      const criado = await invoke<PerfilDeDeck>("criar_perfil", { nome: "Novo painel" });
      await carregar();
      setPerfilId(criado.id);
    } catch (e) {
      setErro(String(e));
    } finally {
      setSalvando(false);
    }
  };

  const duplicar = async () => {
    if (!perfil) return;
    setSalvando(true);
    try {
      const criado = await invoke<PerfilDeDeck>("duplicar_perfil", { id: perfil.id });
      await carregar();
      setPerfilId(criado.id);
    } catch (e) {
      setErro(String(e));
    } finally {
      setSalvando(false);
    }
  };

  const definirPadrao = async () => {
    if (!perfil || !configuracao) return;
    try {
      await invoke("definir_perfil_padrao", { id: perfil.id });
      setConfiguracao({ ...configuracao, perfilPadraoId: perfil.id });
    } catch (e) {
      setErro(String(e));
    }
  };

  const remover = async () => {
    if (!aRemover) return;
    try {
      await invoke("remover_perfil", { id: aRemover.id });
      setARemover(null);
      await carregar();
    } catch (e) {
      setErro(String(e));
    }
  };

  const atualizarItens = (itens: ItemDePerfilDeck[]) => {
    if (perfil) void salvar({ ...perfil, itens });
  };

  const adicionar = (actionId: string) => {
    if (!perfil) return;
    const ordem = perfil.itens
      .filter((item) => item.pagina === pagina)
      .reduce((maior, item) => Math.max(maior, item.ordem), -1) + 1;
    atualizarItens([...perfil.itens, { actionId, pagina, ordem }]);
  };

  const alterarItem = (alvo: ItemDePerfilDeck, mudanca: Partial<ItemDePerfilDeck>) => {
    if (!perfil) return;
    atualizarItens(perfil.itens.map((item) => item === alvo ? { ...item, ...mudanca } : item));
  };

  const mover = (alvo: ItemDePerfilDeck, deslocamento: -1 | 1) => {
    if (!perfil) return;
    const paginaAtual = perfil.itens
      .filter((item) => item.pagina === alvo.pagina)
      .sort((a, b) => a.ordem - b.ordem);
    const indice = paginaAtual.indexOf(alvo);
    const vizinho = paginaAtual[indice + deslocamento];
    if (!vizinho) return;
    atualizarItens(perfil.itens.map((item) => {
      if (item === alvo) return { ...item, ordem: vizinho.ordem };
      if (item === vizinho) return { ...item, ordem: alvo.ordem };
      return item;
    }));
  };

  if (!configuracao) {
    return <section className="tela"><p className="atenuado" aria-busy="true">Carregando painéis…</p></section>;
  }

  if (!perfil) {
    return (
      <section className="tela">
        <div className="vazio">
          <Icone nome="Grade" aria-hidden />
          <h2>Crie seu primeiro painel</h2>
          <p>Monte atalhos para cada momento e troque de contexto com um toque.</p>
          <Botao tom="acento" onClick={() => void criar()}>Criar painel</Botao>
        </div>
      </section>
    );
  }

  const maxPagina = Math.max(0, ...perfil.itens.map((item) => item.pagina));
  const itensDaPagina = perfil.itens
    .filter((item) => item.pagina === pagina)
    .sort((a, b) => a.ordem - b.ordem);
  const usados = new Set(perfil.itens.map((item) => item.actionId));
  const colunas = orientacao === "retrato" ? perfil.colunasRetrato : perfil.colunasPaisagem;

  return (
    <section className="tela tela--paineis">
      <header className="tela__topo">
        <div>
          <h1 className="tela__titulo">Painéis</h1>
          <Rotulo tom="atenuado">Cada perfil vira uma superfície pronta para o momento.</Rotulo>
        </div>
        <Botao tom="acento" estado={salvando ? "loading" : "idle"} onClick={() => void criar()}>
          <Icone nome="Mais" aria-hidden /> Novo painel
        </Botao>
      </header>

      {erro && <p className="erro" role="alert">{erro}</p>}

      <div className="editor-deck">
        <aside className="editor-deck__perfis">
          <span className="editor-deck__rotulo">Seus perfis</span>
          {configuracao.perfis.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`perfil-editor${item.id === perfil.id ? " perfil-editor--ativo" : ""}`}
              style={{ "--tom": `var(--s-control-${item.cor})` } as React.CSSProperties}
              onClick={() => setPerfilId(item.id)}
            >
              <i aria-hidden />
              <span>{item.nome}</span>
              {item.id === configuracao.perfilPadraoId && <Icone nome="Verificado" aria-label="Perfil inicial" />}
            </button>
          ))}
        </aside>

        <div className="editor-deck__principal">
          <div className="editor-deck__cabecalho">
            <label className="nome-perfil">
              <span>Nome do perfil</span>
              <input
                value={perfil.nome}
                maxLength={28}
                onChange={(evento) => setConfiguracao({
                  ...configuracao,
                  perfis: configuracao.perfis.map((item) => item.id === perfil.id ? { ...item, nome: evento.target.value } : item),
                })}
                onBlur={(evento) => {
                  const nome = evento.target.value.trim();
                  if (nome && nome !== perfil.nome) void salvar({ ...perfil, nome });
                }}
              />
            </label>

            <div className="editor-deck__acoes">
              <Botao tamanho="sm" onClick={() => void definirPadrao()} estado={perfil.id === configuracao.perfilPadraoId ? "disabled" : "idle"}>
                <Icone nome="Verificado" aria-hidden /> Inicial
              </Botao>
              <Botao tamanho="sm" onClick={() => void duplicar()}><Icone nome="Camada" aria-hidden /> Duplicar</Botao>
              <Botao tamanho="sm" tom="perigo" onClick={() => setARemover(perfil)}><Icone nome="Lixeira" aria-hidden /> Remover</Botao>
            </div>
          </div>

          <div className="editor-deck__preferencias">
            <div className="preferencia-deck">
              <span>Cor</span>
              <div className="cores cores--compactas">
                {CORES.map((cor) => (
                  <button
                    key={cor}
                    type="button"
                    className={`cor${perfil.cor === cor ? " cor--ativa" : ""}`}
                    style={{ "--tom": `var(--s-control-${cor})` } as React.CSSProperties}
                    aria-label={cor}
                    aria-pressed={perfil.cor === cor}
                    onClick={() => void salvar({ ...perfil, cor })}
                  />
                ))}
              </div>
            </div>

            <div className="preferencia-deck">
              <span>Prévia</span>
              <div className="seletor-modo">
                {(["retrato", "paisagem"] as const).map((modo) => (
                  <button key={modo} type="button" className={`seletor-modo__opcao${orientacao === modo ? " ativa" : ""}`} onClick={() => setOrientacao(modo)}>
                    {modo === "retrato" ? "Vertical" : "Horizontal"}
                  </button>
                ))}
              </div>
            </div>

            <div className="preferencia-deck preferencia-deck--colunas">
              <span>Colunas</span>
              <div className="stepper-colunas">
                <button type="button" onClick={() => {
                  const chave = orientacao === "retrato" ? "colunasRetrato" : "colunasPaisagem";
                  const minimo = orientacao === "retrato" ? 2 : 4;
                  void salvar({ ...perfil, [chave]: Math.max(minimo, colunas - 1) });
                }} aria-label="Menos colunas">−</button>
                <strong>{colunas}</strong>
                <button type="button" onClick={() => {
                  const chave = orientacao === "retrato" ? "colunasRetrato" : "colunasPaisagem";
                  const maximo = orientacao === "retrato" ? 3 : 6;
                  void salvar({ ...perfil, [chave]: Math.min(maximo, colunas + 1) });
                }} aria-label="Mais colunas">+</button>
              </div>
            </div>
          </div>

          <div className="paginas-editor">
            {Array.from({ length: maxPagina + 1 }, (_, indice) => (
              <button key={indice} type="button" className={pagina === indice ? "ativa" : ""} onClick={() => setPagina(indice)}>
                Página {indice + 1}
              </button>
            ))}
            {maxPagina < 9 && <button type="button" className="paginas-editor__nova" onClick={() => setPagina(maxPagina + 1)}><Icone nome="Mais" aria-hidden /> Nova página</button>}
          </div>

          <div className={`preview-deck preview-deck--${orientacao}`} style={{ "--colunas": colunas } as React.CSSProperties}>
            {itensDaPagina.map((item, indice) => {
              const acao = catalogoPorId.get(item.actionId);
              return (
                <article key={`${item.actionId}:${item.ordem}`} className={`item-deck${item.tamanho === "largo" ? " item-deck--largo" : ""}`} style={{ "--tom": `var(--s-control-${item.cor ?? perfil.cor})` } as React.CSSProperties}>
                  <span className="item-deck__arte"><ArteDaAcao acao={acao} /></span>
                  <strong>{acao?.nome ?? item.actionId}</strong>
                  <div className="item-deck__acoes">
                    <button type="button" onClick={() => mover(item, -1)} disabled={indice === 0} aria-label="Mover para trás"><Icone nome="Voltar" aria-hidden /></button>
                    <button type="button" onClick={() => mover(item, 1)} disabled={indice === itensDaPagina.length - 1} aria-label="Mover para frente"><Icone nome="Avancar" aria-hidden /></button>
                    <button type="button" onClick={() => alterarItem(item, { tamanho: item.tamanho === "largo" ? "normal" : "largo" })} aria-label="Alternar largura"><Icone nome="Camada" aria-hidden /></button>
                    {maxPagina > 0 && <button type="button" onClick={() => alterarItem(item, { pagina: item.pagina === maxPagina ? 0 : item.pagina + 1, ordem: 99 })} aria-label="Mover para outra página"><Icone nome="Grade" aria-hidden /></button>}
                    <button type="button" onClick={() => atualizarItens(perfil.itens.filter((existente) => existente !== item))} aria-label="Remover do painel"><Icone nome="Fechar" aria-hidden /></button>
                  </div>
                </article>
              );
            })}
            {itensDaPagina.length === 0 && <div className="preview-deck__vazio"><Icone nome="Mais" aria-hidden /><span>Escolha um controle abaixo para começar esta página.</span></div>}
          </div>

          <div className="catalogo-deck">
            <div className="catalogo-deck__cabecalho"><div><strong>Adicionar controles</strong><span>Disponíveis para este computador</span></div><Rotulo tamanho="2xs" tom="sutil">{perfil.itens.length}/200</Rotulo></div>
            {(["Mídia", "Volume", "Serviços", "Programas"] as const).map((grupo) => {
              const acoes = catalogo.filter((acao) => acao.grupo === grupo);
              if (acoes.length === 0) return null;
              return <div className="catalogo-deck__grupo" key={grupo}><span>{grupo}</span><div>{acoes.map((acao) => <button key={acao.actionId} type="button" disabled={usados.has(acao.actionId)} onClick={() => adicionar(acao.actionId)}><span className="catalogo-deck__arte"><ArteDaAcao acao={acao} /></span><span>{acao.nome}</span>{usados.has(acao.actionId) ? <Icone nome="Verificado" aria-label="Adicionado" /> : <Icone nome="Mais" aria-hidden />}</button>)}</div></div>;
            })}
          </div>
        </div>
      </div>

      <Modal
        aberto={aRemover !== null}
        titulo="Remover este painel?"
        descricao={aRemover ? `“${aRemover.nome}” deixa de aparecer nos aparelhos conectados.` : undefined}
        aoFechar={() => setARemover(null)}
        acoes={<><Botao onClick={() => setARemover(null)}>Cancelar</Botao><Botao tom="perigo" onClick={() => void remover()}>Remover painel</Botao></>}
      />
    </section>
  );
}

/**
 * O símbolo de uma ação, seja ela qual for.
 *
 * Três origens — o ícone do executável, a marca do serviço, o ícone do sistema
 * — e um lugar só que decide entre elas. Antes a prévia e o catálogo repetiam
 * essa escolha em duas expressões separadas, e foi assim que o ícone real do
 * programa ficou de fora das duas.
 */
function ArteDaAcao({ acao }: { acao?: AcaoCatalogo }) {
  if (acao?.arte) {
    // Origem 32×32: suavizar borra justamente o desenho que identifica o jogo.
    return <img src={acao.arte} alt="" aria-hidden style={{ imageRendering: "pixelated" }} />;
  }
  if (acao?.marca) {
    return (
      <span className={`marca-servico marca-servico--${acao.marca}`}>
        <Marca nome={acao.marca} tamanho="100%" />
      </span>
    );
  }
  return <Icone nome={acao?.icone ?? "Grade"} aria-hidden />;
}
