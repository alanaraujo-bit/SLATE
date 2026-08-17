"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icone, Marca, Rotulo } from "@slate/design-system";
import type { AtalhoDeDeck, ItemDePerfilDeck, PerfilDeDeck } from "@slate/protocol";
import {
  CONTROLES_ATALHOS,
  CONTROLES_MIDIA,
  CONTROLES_VOLUME,
  acaoDoPrograma,
  visiveis,
  type Controle,
} from "@/lib/controles";
import type { ResultadoExecucaoAcao } from "@/lib/transporte-webrtc";

export function ControlesBasicos({
  executar,
  gradeCompleta = false,
  atalhosLiberados = false,
  programas = [],
  perfis = [],
  perfilPadraoId,
}: {
  executar: (actionId: string) => Promise<ResultadoExecucaoAcao>;
  /**
   * Atalhos de programa cadastrados naquele computador, como ele os enviou.
   *
   * Vazio é o normal: só chega lista para quem tem a permissão, e só depois de
   * alguém cadastrar programas na janela do Agente.
   */
  programas?: readonly AtalhoDeDeck[];
  /** Perfis criados no desktop. Ausente mantém a grade clássica. */
  perfis?: readonly PerfilDeDeck[];
  perfilPadraoId?: string;
  /** O Agente anunciou `action.media.completo` no handshake. */
  gradeCompleta?: boolean;
  /**
   * O Agente anunciou `action.atalhos` — ou seja, este aparelho recebeu a
   * permissão de abrir programas naquele computador, marcada lá.
   */
  atalhosLiberados?: boolean;
}) {
  /**
   * Só o erro vira texto na tela.
   *
   * Antes a grade esperava a resposta antes de aceitar o toque seguinte, e
   * volume ficava impraticável: cada aperto exigia uma ida e volta inteira até
   * o computador. Num painel de atalhos isso é defeito, não cautela — apertar
   * cinco vezes precisa mandar cinco comandos.
   *
   * O transporte já aceita pedidos simultâneos (cada um tem id próprio e é
   * resolvido pelo mapa de pendentes), então não havia nada a proteger. Agora
   * o toque dispara e pronto. A confirmação de que funcionou é o computador
   * reagir; anunciar "deu certo" a cada toque só empilharia ruído.
   */
  const [erro, setErro] = useState<string | null>(null);

  const acionar = (actionId: string) => {
    void executar(actionId).then((r) => setErro(r.ok ? null : r.mensagem));
  };

  const midia = visiveis(CONTROLES_MIDIA, gradeCompleta);
  const volume = visiveis(CONTROLES_VOLUME, gradeCompleta);

  if (perfis.length > 0) {
    return (
      <PainelDePerfis
        perfis={perfis}
        perfilPadraoId={perfilPadraoId}
        programas={programas}
        gradeCompleta={gradeCompleta}
        acionar={acionar}
        erro={erro}
      />
    );
  }

  const botao = (controle: Controle) => (
    <button
      key={controle.actionId}
      type="button"
      className={`tecla${controle.destaque ? " tecla--destaque" : ""}`}
      // Sem `disabled`: nenhuma tecla espera outra. O retorno ao dedo é o
      // `:active` do CSS, que é imediato e não depende da rede.
      onClick={() => acionar(controle.actionId)}
    >
      <Representacao controle={controle} />
      <span>{controle.rotulo}</span>
    </button>
  );

  /*
   * A tecla de um programa cadastrado.
   *
   * Separada da tecla comum de propósito: o ícone aqui é uma imagem que veio
   * do outro computador, e não um nome do design system. Alargar `Controle`
   * para caber os dois faria toda tecla carregar um campo que quase nenhuma
   * usa — e o schema já garante que o valor é um PNG embutido.
   *
   * A cor vira `--tom`, a mesma variável que o CSS já usa em `.tecla`.
   */
  const teclaDePrograma = (programa: AtalhoDeDeck) => (
    <button
      key={programa.id}
      type="button"
      className="tecla tecla--programa"
      style={{ "--tom": `var(--s-control-${programa.cor})` } as React.CSSProperties}
      onClick={() => acionar(acaoDoPrograma(programa.id))}
    >
      {programa.icone ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="tecla__icone" src={programa.icone} alt="" aria-hidden />
      ) : (
        <Icone nome="Monitor" aria-hidden />
      )}
      <span>{programa.nome}</span>
    </button>
  );

  return (
    <section
      // Com um Agente antigo só sobra o grupo de mídia, e a divisão em duas
      // colunas do modo deitado deixaria metade da tela vazia.
      className={`painel${
        volume.length === 0 && !atalhosLiberados ? " painel--coluna-unica" : ""
      }`}
      aria-label="Controles do computador"
    >
      <div className="painel__grupo painel__grupo--midia">
        <div className="painel__cabecalho">
          <h2>Mídia</h2>
          <Rotulo tamanho="xs" tom="sutil">
            Funciona com o aplicativo de mídia ativo no Windows.
          </Rotulo>
        </div>
        <div className="grade-teclas">{midia.map(botao)}</div>
      </div>

      {volume.length > 0 && (
        <div className="painel__grupo painel__grupo--volume">
          <div className="painel__cabecalho">
            <h2>Volume</h2>
          </div>
          <div className="grade-teclas">{volume.map(botao)}</div>
        </div>
      )}

      {atalhosLiberados && (
        <div className="painel__grupo painel__grupo--atalhos">
          <div className="painel__cabecalho">
            <h2>Abrir</h2>
            <Rotulo tamanho="xs" tom="sutil">
              Abre no navegador padrão do computador.
            </Rotulo>
          </div>
          <div className="grade-teclas">{CONTROLES_ATALHOS.map(botao)}</div>
        </div>
      )}

      {atalhosLiberados && programas.length > 0 && (
        <div className="painel__grupo painel__grupo--programas">
          <div className="painel__cabecalho">
            <h2>Programas</h2>
            <Rotulo tamanho="xs" tom="sutil">
              Cadastrados na janela do SLATE naquele computador.
            </Rotulo>
          </div>
          <div className="grade-teclas">{programas.map(teclaDePrograma)}</div>
        </div>
      )}

      {!gradeCompleta && (
        <Rotulo tamanho="xs" tom="sutil">
          Atualize o Agente no computador para liberar faixa, parada e volume.
        </Rotulo>
      )}

      {gradeCompleta && !atalhosLiberados && (
        <Rotulo tamanho="xs" tom="sutil">
          Para abrir programas, autorize este aparelho na janela do SLATE no
          computador. A permissão é dada lá de propósito: nenhum aparelho amplia
          os próprios poderes à distância.
        </Rotulo>
      )}

      {erro && (
        <p className="controle-resultado controle-resultado--erro" role="alert">
          {erro}
        </p>
      )}
    </section>
  );
}

function Representacao({ controle }: { controle: Controle }) {
  if (controle.marca) {
    return (
      <span className={`marca-servico marca-servico--${controle.marca}`}>
        <Marca nome={controle.marca} tamanho="100%" />
      </span>
    );
  }
  return <Icone nome={controle.icone} aria-hidden />;
}

function PainelDePerfis({
  perfis,
  perfilPadraoId,
  programas,
  gradeCompleta,
  acionar,
  erro,
}: {
  perfis: readonly PerfilDeDeck[];
  perfilPadraoId?: string;
  programas: readonly AtalhoDeDeck[];
  gradeCompleta: boolean;
  acionar: (actionId: string) => void;
  erro: string | null;
}) {
  const perfilInicial =
    perfis.find((perfil) => perfil.id === perfilPadraoId)?.id ?? perfis[0]?.id ?? "";
  const [perfilId, setPerfilId] = useState(perfilInicial);
  const [pagina, setPagina] = useState(0);
  const inicioArraste = useRef<number | null>(null);
  const ignorarCliqueAte = useRef(0);

  useEffect(() => {
    if (!perfis.some((perfil) => perfil.id === perfilId)) setPerfilId(perfilInicial);
  }, [perfilId, perfilInicial, perfis]);

  useEffect(() => setPagina(0), [perfilId]);

  const perfil = perfis.find((item) => item.id === perfilId) ?? perfis[0];
  const controles = useMemo(
    () =>
      new Map(
        [...visiveis(CONTROLES_MIDIA, gradeCompleta), ...visiveis(CONTROLES_VOLUME, gradeCompleta), ...CONTROLES_ATALHOS].map(
          (controle) => [controle.actionId, controle] as const,
        ),
      ),
    [gradeCompleta],
  );
  const programasPorAcao = useMemo(
    () => new Map(programas.map((programa) => [acaoDoPrograma(programa.id), programa] as const)),
    [programas],
  );

  if (!perfil) return null;

  const totalPaginas = Math.max(1, ...perfil.itens.map((item) => item.pagina + 1));
  const itens = perfil.itens
    .filter((item) => item.pagina === pagina)
    .sort((a, b) => a.ordem - b.ordem)
    .filter((item) => controles.has(item.actionId) || programasPorAcao.has(item.actionId));

  const mudarPagina = (direcao: -1 | 1) => {
    setPagina((atual) => Math.min(totalPaginas - 1, Math.max(0, atual + direcao)));
  };

  const terminarArraste = (x: number) => {
    if (inicioArraste.current === null) return;
    const distancia = x - inicioArraste.current;
    inicioArraste.current = null;
    if (Math.abs(distancia) < 52) return;
    ignorarCliqueAte.current = Date.now() + 300;
    mudarPagina(distancia < 0 ? 1 : -1);
  };

  const executar = (actionId: string) => {
    if (Date.now() >= ignorarCliqueAte.current) acionar(actionId);
  };

  const renderizarItem = (item: ItemDePerfilDeck) => {
    const controle = controles.get(item.actionId);
    const programa = programasPorAcao.get(item.actionId);
    const cor = item.cor ?? perfil.cor;
    return (
      <button
        key={`${item.pagina}:${item.ordem}:${item.actionId}`}
        type="button"
        className={`tecla tecla--perfil${item.tamanho === "largo" ? " tecla--larga" : ""}`}
        style={{ "--tom": `var(--s-control-${cor})` } as React.CSSProperties}
        onClick={() => executar(item.actionId)}
      >
        {programa ? (
          programa.icone ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="tecla__icone" src={programa.icone} alt="" aria-hidden />
          ) : (
            <Icone nome="Monitor" aria-hidden />
          )
        ) : controle ? (
          <Representacao controle={controle} />
        ) : null}
        <span>{programa?.nome ?? controle?.rotulo}</span>
      </button>
    );
  };

  return (
    <section className="painel-perfis" aria-label="Painel de controle">
      <header className="seletor-perfis">
        <div className="seletor-perfis__trilha" role="tablist" aria-label="Perfis">
          {perfis.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={item.id === perfil.id}
              className={`perfil-chip${item.id === perfil.id ? " perfil-chip--ativo" : ""}`}
              style={{ "--perfil-cor": `var(--s-control-${item.cor})` } as React.CSSProperties}
              onClick={() => setPerfilId(item.id)}
            >
              <i aria-hidden />
              {item.nome}
            </button>
          ))}
        </div>
        <span className="seletor-perfis__pagina">
          {totalPaginas > 1 ? `${pagina + 1} / ${totalPaginas}` : "Painel pronto"}
        </span>
      </header>

      <div
        className="pagina-perfil"
        onPointerDown={(evento) => {
          if (evento.pointerType !== "mouse" || evento.buttons === 1) {
            inicioArraste.current = evento.clientX;
          }
        }}
        onPointerUp={(evento) => terminarArraste(evento.clientX)}
        onPointerCancel={() => {
          inicioArraste.current = null;
        }}
      >
        <div
          className="grade-perfil"
          style={
            {
              "--colunas-retrato": perfil.colunasRetrato,
              "--colunas-paisagem": perfil.colunasPaisagem,
            } as React.CSSProperties
          }
        >
          {itens.map(renderizarItem)}
        </div>

        {itens.length === 0 && (
          <div className="pagina-perfil__vazia">
            <Icone nome="Grade" aria-hidden />
            <strong>Página vazia</strong>
            <span>Adicione controles pelo SLATE no computador.</span>
          </div>
        )}
      </div>

      {totalPaginas > 1 && (
        <nav className="paginacao-perfil" aria-label="Páginas do perfil">
          <button type="button" onClick={() => mudarPagina(-1)} disabled={pagina === 0} aria-label="Página anterior">
            <Icone nome="Voltar" aria-hidden />
          </button>
          <span>
            {Array.from({ length: totalPaginas }, (_, indice) => (
              <button
                key={indice}
                type="button"
                className={indice === pagina ? "ativo" : ""}
                aria-label={`Página ${indice + 1}`}
                aria-current={indice === pagina ? "page" : undefined}
                onClick={() => setPagina(indice)}
              />
            ))}
          </span>
          <button type="button" onClick={() => mudarPagina(1)} disabled={pagina === totalPaginas - 1} aria-label="Próxima página">
            <Icone nome="Avancar" aria-hidden />
          </button>
        </nav>
      )}

      {erro && (
        <p className="controle-resultado controle-resultado--erro" role="alert">{erro}</p>
      )}
    </section>
  );
}
