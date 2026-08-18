import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Botao, Icone, Rotulo } from "@slate/design-system";
import { Modal } from "../modal";

/**
 * Cadastro do que o celular pode abrir: programas deste disco e endereços.
 *
 * **Definir acontece aqui, e não no celular.** O ADR-0004 põe `action.define`
 * fora do alcance de um aparelho: escolher o que um atalho abre é ato de quem
 * está na frente da máquina. O celular manda `programa.<id>` para os dois tipos
 * — nem o caminho do executável nem o endereço atravessam o canal, e o aparelho
 * não tem como saber qual das duas coisas a tecla abre.
 *
 * O programa vem do seletor de arquivo nativo; o endereço é digitado, que é a
 * única coisa deste cadastro que não nasce de um diálogo do Windows. Isso não
 * afrouxa nada: continua sendo alguém na frente do computador, e o Rust confere
 * o esquema (`http`/`https`) na gravação e de novo na execução.
 */

export interface Atalho {
  id: string;
  nome: string;
  /** Vazio quando o atalho é um endereço. */
  caminho: string;
  url?: string;
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
 * Lado da arte guardada, em pontos.
 *
 * A tecla no celular nunca passa muito disso, e o que sobra de resolução vira
 * peso numa mensagem que atravessa o DataChannel. 64 dá nitidez em tela retina
 * sem chegar perto do teto de `MAXIMO_ICONE`, no Rust — um PNG de 64×64 com
 * transparência fica na casa de poucos quilobytes.
 */
const LADO_DA_TECLA = 64;

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

/**
 * Deriva um nome a partir do endereço digitado.
 *
 * O domínio sem `www.` é o que a pessoa chamaria aquilo: quem cadastra
 * `https://www.twitch.tv/directory` está pensando "twitch", não no caminho. O
 * palpite é só palpite — o campo continua editável antes de salvar.
 */
export function nomeDoEndereco(url: string): string {
  const semEsquema = url.trim().replace(/^https?:\/\//i, "");
  const hospedeiro = semEsquema.split(/[/?#]/)[0] ?? "";
  const limpo = hospedeiro.replace(/^www\./i, "").split(":")[0] ?? "";
  return limpo.slice(0, 40) || "Endereço";
}

/**
 * Encolhe uma imagem para o tamanho de uma tecla, dentro do próprio webview.
 *
 * **É aqui porque a janela já é um navegador.** Ela decodifica PNG, JPEG, GIF,
 * WebP e ICO sem nenhuma biblioteca; fazer o mesmo no Rust exigiria trazer um
 * codec para cada formato. O favicon de um site e a imagem escolhida à mão
 * passam pelo mesmo caminho, então só existe um lugar onde o tamanho é
 * decidido.
 *
 * Falhar devolve a imagem como veio. O Rust confere o tamanho na gravação
 * (`MAXIMO_ICONE`) e recusa com uma frase legível — isto aqui é conveniência,
 * não a garantia.
 */
export async function encolherParaTecla(dataUri: string): Promise<string> {
  try {
    const imagem = new Image();
    await new Promise<void>((resolver, rejeitar) => {
      imagem.onload = () => resolver();
      imagem.onerror = () => rejeitar(new Error("imagem ilegível"));
      imagem.src = dataUri;
    });

    const tela = document.createElement("canvas");
    tela.width = LADO_DA_TECLA;
    tela.height = LADO_DA_TECLA;
    const pincel = tela.getContext("2d");
    if (!pincel) return dataUri;

    // Cabe inteira e continua centralizada: esticar para preencher deformaria
    // logotipos largos, e cortar comeria justamente a borda do desenho.
    const escala = Math.min(
      LADO_DA_TECLA / (imagem.width || LADO_DA_TECLA),
      LADO_DA_TECLA / (imagem.height || LADO_DA_TECLA),
    );
    const largura = Math.max(1, Math.round((imagem.width || LADO_DA_TECLA) * escala));
    const altura = Math.max(1, Math.round((imagem.height || LADO_DA_TECLA) * escala));
    pincel.drawImage(
      imagem,
      Math.round((LADO_DA_TECLA - largura) / 2),
      Math.round((LADO_DA_TECLA - altura) / 2),
      largura,
      altura,
    );

    const encolhida = tela.toDataURL("image/png");
    // Um `canvas` sem suporte devolve `data:,` — nesse caso a original serve
    // mais do que uma imagem vazia.
    return encolhida.startsWith("data:image/") ? encolhida : dataUri;
  } catch {
    return dataUri;
  }
}

export function TelaProgramas({ podeUsar }: { podeUsar: boolean }) {
  const [atalhos, setAtalhos] = useState<Atalho[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [emEdicao, setEmEdicao] = useState<Atalho | null>(null);
  const [aRemover, setARemover] = useState<Atalho | null>(null);
  const [adicionando, setAdicionando] = useState(false);
  const [criandoSite, setCriandoSite] = useState(false);

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

  const criarSite = async (url: string, nome: string, cor: string, icone: string | null) => {
    setErro(null);
    try {
      await invoke("criar_atalho_de_site", { url, nome, cor, icone });
      setCriandoSite(false);
      await carregar();
    } catch (e) {
      setErro(String(e));
    }
  };

  const salvar = async (atalho: Atalho, nome: string, cor: string, url: string | null) => {
    setErro(null);
    try {
      await invoke("renomear_atalho", { id: atalho.id, nome, cor, url });
      setEmEdicao(null);
      await carregar();
    } catch (e) {
      setErro(String(e));
    }
  };

  const trocarIcone = async (atalho: Atalho, icone: string | null) => {
    setErro(null);
    try {
      await invoke("definir_icone", { id: atalho.id, icone });
      await carregar();
      setEmEdicao((atual) => (atual ? { ...atual, icone: icone ?? undefined } : atual));
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
            Programas, jogos e endereços que o celular pode abrir daqui.
          </Rotulo>
        </div>
        <div className="tela__acoes">
          <Botao onClick={() => setCriandoSite(true)}>
            <Icone nome="Ligacao" aria-hidden />
            Adicionar endereço
          </Botao>
          <Botao
            tom="acento"
            estado={adicionando ? "loading" : "idle"}
            onClick={() => void adicionar()}
          >
            <Icone nome="Mais" aria-hidden />
            Adicionar programa
          </Botao>
        </div>
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
            O ícone de um programa vem do próprio arquivo, e o de um endereço vem
            do site — e você pode trocar qualquer um dos dois por uma imagem sua.
            O celular recebe só o nome, a cor e o desenho; nunca o caminho neste
            computador nem o endereço.
          </p>
          <div className="vazio__acoes">
            <Botao
              tom="acento"
              estado={adicionando ? "loading" : "idle"}
              onClick={() => void adicionar()}
            >
              Escolher o primeiro
            </Botao>
            <Botao onClick={() => setCriandoSite(true)}>Adicionar endereço</Botao>
          </div>
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
                  <Icone nome={atalho.url ? "Ligacao" : "Monitor"} aria-hidden />
                )}
              </span>
              <span className="programa__texto">
                <span className="programa__nome">{atalho.nome}</span>
                {/* O caminho e o endereço aparecem aqui, na máquina que já os
                    conhece — é o que permite distinguir dois jogos de mesmo
                    nome. Nenhum dos dois sai deste computador. */}
                <span className="programa__caminho" title={atalho.url ?? atalho.caminho}>
                  {atalho.url ?? atalho.caminho}
                </span>
              </span>
              <span className="programa__acoes">
                <Botao tamanho="sm" onClick={() => setEmEdicao(atalho)}>
                  <Icone nome="Lapis" aria-hidden />
                  Editar
                </Botao>
                <Botao tamanho="sm" tom="perigo" onClick={() => setARemover(atalho)}>
                  <Icone nome="Lixeira" aria-hidden />
                  Remover
                </Botao>
              </span>
            </li>
          ))}
        </ul>
      )}

      {criandoSite && (
        <ModalEndereco
          corSugerida={CORES[atalhos.length % CORES.length]}
          aoCriar={(url, nome, cor, icone) => void criarSite(url, nome, cor, icone)}
          aoFechar={() => setCriandoSite(false)}
        />
      )}

      {emEdicao && (
        <ModalEdicao
          atalho={emEdicao}
          aoSalvar={(nome, cor, url) => void salvar(emEdicao, nome, cor, url)}
          aoTrocarIcone={(icone) => void trocarIcone(emEdicao, icone)}
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

/**
 * A arte da tecla, com as três origens possíveis.
 *
 * Buscar do site, escolher uma imagem e não ter nenhuma são estados igualmente
 * válidos — um favicon de 16 pontos esticado pode ficar pior que uma tecla
 * limpa com a cor certa, e quem está olhando é quem decide.
 */
function SeletorDeIcone({
  icone,
  cor,
  podeBuscar,
  buscando,
  aoBuscar,
  aoTrocar,
  aoRemover,
}: {
  icone: string | null;
  cor: string;
  podeBuscar: boolean;
  buscando: boolean;
  aoBuscar: () => void;
  aoTrocar: () => void;
  aoRemover: () => void;
}) {
  return (
    <div className="icone-tecla">
      <span
        className="icone-tecla__previa"
        style={{ ["--tom" as string]: `var(--s-control-${cor})` }}
      >
        {icone ? (
          <img src={icone} alt="Prévia da tecla" />
        ) : (
          <Icone nome="Ligacao" aria-hidden />
        )}
      </span>
      <div className="icone-tecla__acoes">
        {podeBuscar && (
          <Botao
            tamanho="sm"
            estado={buscando ? "loading" : "idle"}
            onClick={aoBuscar}
          >
            Buscar do site
          </Botao>
        )}
        <Botao tamanho="sm" onClick={aoTrocar}>
          Escolher imagem
        </Botao>
        {icone && (
          <Botao tamanho="sm" onClick={aoRemover}>
            Sem imagem
          </Botao>
        )}
      </div>
    </div>
  );
}

function EscolhaDeCor({
  cor,
  aoEscolher,
}: {
  cor: string;
  aoEscolher: (cor: string) => void;
}) {
  return (
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
          onClick={() => aoEscolher(disponivel)}
        />
      ))}
    </fieldset>
  );
}

function ModalEndereco({
  corSugerida,
  aoCriar,
  aoFechar,
}: {
  corSugerida: string;
  aoCriar: (url: string, nome: string, cor: string, icone: string | null) => void;
  aoFechar: () => void;
}) {
  const [url, setUrl] = useState("");
  const [nome, setNome] = useState("");
  const [nomeTocado, setNomeTocado] = useState(false);
  const [cor, setCor] = useState(corSugerida);
  const [icone, setIcone] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const completo = (bruta: string) =>
    /^https?:\/\//i.test(bruta.trim()) ? bruta.trim() : `https://${bruta.trim()}`;

  /**
   * Procura o desenho do site assim que o endereço para de ser digitado.
   *
   * Automático porque é o caso comum: quem cadastra um site espera a marca
   * dele aparecer, e um botão a mais faria a maioria das teclas nascer cinza
   * por ninguém ter percebido que precisava apertar.
   */
  const buscar = async (enderecoBruto: string) => {
    const endereco = completo(enderecoBruto);
    if (!/^https?:\/\/[^\s/]+/i.test(endereco)) return;
    setBuscando(true);
    setAviso(null);
    try {
      const achado = await invoke<string | null>("buscar_favicon", { url: endereco });
      if (achado) setIcone(await encolherParaTecla(achado));
      else setAviso("Este site não tem um desenho que dê para usar. Escolha uma imagem, se quiser.");
    } catch {
      // Não achar arte não impede cadastrar, então não vira erro vermelho.
      setAviso("Não deu para buscar o desenho do site agora.");
    } finally {
      setBuscando(false);
    }
  };

  const escolherImagem = async () => {
    try {
      const bruta = await invoke<string | null>("escolher_icone");
      if (bruta) {
        setIcone(await encolherParaTecla(bruta));
        setAviso(null);
      }
    } catch (e) {
      setAviso(String(e));
    }
  };

  const nomeFinal = (nomeTocado ? nome : nomeDoEndereco(url)).trim();

  return (
    <Modal
      aberto
      titulo="Adicionar endereço"
      descricao="Uma tecla que abre um site no navegador padrão deste computador."
      aoFechar={aoFechar}
      acoes={
        <>
          <Botao onClick={aoFechar}>Cancelar</Botao>
          <Botao
            tom="acento"
            estado={url.trim() && nomeFinal ? "idle" : "disabled"}
            onClick={() => aoCriar(completo(url), nomeFinal, cor, icone)}
          >
            Adicionar
          </Botao>
        </>
      }
    >
      <label className="campo">
        <span>Endereço</span>
        <input
          value={url}
          maxLength={2048}
          placeholder="https://exemplo.com"
          inputMode="url"
          onChange={(e) => setUrl(e.target.value)}
          onBlur={(e) => void buscar(e.target.value)}
          autoFocus
        />
      </label>

      <label className="campo">
        <span>Nome</span>
        <input
          value={nomeTocado ? nome : nomeDoEndereco(url)}
          maxLength={40}
          onChange={(e) => {
            setNomeTocado(true);
            setNome(e.target.value);
          }}
        />
      </label>

      <SeletorDeIcone
        icone={icone}
        cor={cor}
        podeBuscar
        buscando={buscando}
        aoBuscar={() => void buscar(url)}
        aoTrocar={() => void escolherImagem()}
        aoRemover={() => setIcone(null)}
      />

      {aviso && (
        <p className="atenuado" role="status">
          {aviso}
        </p>
      )}

      <EscolhaDeCor cor={cor} aoEscolher={setCor} />
    </Modal>
  );
}

function ModalEdicao({
  atalho,
  aoSalvar,
  aoTrocarIcone,
  aoFechar,
}: {
  atalho: Atalho;
  aoSalvar: (nome: string, cor: string, url: string | null) => void;
  aoTrocarIcone: (icone: string | null) => void;
  aoFechar: () => void;
}) {
  const [nome, setNome] = useState(atalho.nome);
  const [cor, setCor] = useState(atalho.cor);
  const [url, setUrl] = useState(atalho.url ?? "");
  const [buscando, setBuscando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const eSite = atalho.url !== undefined;

  const buscar = async () => {
    setBuscando(true);
    setAviso(null);
    try {
      const achado = await invoke<string | null>("buscar_favicon", { url });
      if (achado) aoTrocarIcone(await encolherParaTecla(achado));
      else setAviso("Este site não tem um desenho que dê para usar.");
    } catch {
      setAviso("Não deu para buscar o desenho do site agora.");
    } finally {
      setBuscando(false);
    }
  };

  const escolherImagem = async () => {
    try {
      const bruta = await invoke<string | null>("escolher_icone");
      if (bruta) {
        aoTrocarIcone(await encolherParaTecla(bruta));
        setAviso(null);
      }
    } catch (e) {
      setAviso(String(e));
    }
  };

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
            estado={nome.trim() && (!eSite || url.trim()) ? "idle" : "disabled"}
            onClick={() => aoSalvar(nome, cor, eSite ? url.trim() : null)}
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

      {eSite && (
        <label className="campo">
          <span>Endereço</span>
          <input
            value={url}
            maxLength={2048}
            inputMode="url"
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
      )}

      {/* A troca de imagem vale na hora, e não ao salvar: ela já foi gravada
          pelo comando próprio. Sem isso a prévia mostraria um desenho que o
          botão Cancelar não desfaria. */}
      <SeletorDeIcone
        icone={atalho.icone ?? null}
        cor={cor}
        podeBuscar={eSite}
        buscando={buscando}
        aoBuscar={() => void buscar()}
        aoTrocar={() => void escolherImagem()}
        aoRemover={() => aoTrocarIcone(null)}
      />

      {aviso && (
        <p className="atenuado" role="status">
          {aviso}
        </p>
      )}

      <EscolhaDeCor cor={cor} aoEscolher={setCor} />
    </Modal>
  );
}
