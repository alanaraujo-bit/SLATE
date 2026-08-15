import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { useCallback, useEffect, useRef, useState } from "react";

const ESPERA_INICIAL_MS = 8_000;
const INTERVALO_BUSCA_MS = 6 * 60 * 60 * 1_000;

export type SituacaoAtualizacao =
  | { tipo: "repouso" }
  | { tipo: "buscando"; manual: boolean }
  | { tipo: "atual"; versao: string }
  | { tipo: "disponivel"; versao: string; notas?: string }
  | { tipo: "baixando"; versao: string; baixados: number; total?: number }
  | { tipo: "instalando"; versao: string }
  | { tipo: "erro"; mensagem: string };

export function aplicarEventoDownload(
  situacao: Extract<SituacaoAtualizacao, { tipo: "baixando" }>,
  evento: DownloadEvent,
): SituacaoAtualizacao {
  if (evento.event === "Started") {
    return { ...situacao, total: evento.data.contentLength };
  }
  if (evento.event === "Progress") {
    return { ...situacao, baixados: situacao.baixados + evento.data.chunkLength };
  }
  return { tipo: "instalando", versao: situacao.versao };
}

export function mensagemDeErro(erro: unknown): string {
  const bruto = String(erro).toLocaleLowerCase("pt-BR");
  if (
    bruto.includes("status code: 503") ||
    bruto.includes("release json") ||
    bruto.includes("github releases")
  ) {
    return "As atualizações ainda não estão configuradas neste ambiente.";
  }
  if (bruto.includes("network") || bruto.includes("fetch") || bruto.includes("conex")) {
    return "Não foi possível consultar agora. Confira a internet e tente novamente.";
  }
  if (bruto.includes("signature") || bruto.includes("assinatura")) {
    return "A atualização não passou na verificação de segurança e não foi instalada.";
  }
  return "Não foi possível atualizar agora. O SLATE continua funcionando nesta versão.";
}

export function Atualizador() {
  const [situacao, setSituacao] = useState<SituacaoAtualizacao>({ tipo: "repouso" });
  const [versaoAtual, setVersaoAtual] = useState<string>("");
  const atualizacao = useRef<Update | null>(null);
  const ocupado = situacao.tipo === "buscando" || situacao.tipo === "baixando" || situacao.tipo === "instalando";

  const buscar = useCallback(async (manual = true) => {
    if (ocupado) return;
    if (manual) setSituacao({ tipo: "buscando", manual: true });

    try {
      const encontrada = await check({ timeout: 15_000 });
      if (atualizacao.current && atualizacao.current !== encontrada) {
        await atualizacao.current.close().catch(() => undefined);
      }
      atualizacao.current = encontrada;

      if (encontrada) {
        setSituacao({
          tipo: "disponivel",
          versao: encontrada.version,
          ...(encontrada.body?.trim() ? { notas: encontrada.body.trim() } : {}),
        });
      } else if (manual) {
        setSituacao({ tipo: "atual", versao: await getVersion() });
      }
    } catch (erro) {
      // Estar sem internet não transforma a abertura normal do Agente num
      // alerta. Quando a pessoa pediu a busca, porém, escondê-lo seria mentir.
      if (manual) setSituacao({ tipo: "erro", mensagem: mensagemDeErro(erro) });
    }
  }, [ocupado]);

  useEffect(() => {
    void getVersion().then(setVersaoAtual).catch(() => undefined);
    const primeira = window.setTimeout(() => void buscar(false), ESPERA_INICIAL_MS);
    const intervalo = window.setInterval(() => void buscar(false), INTERVALO_BUSCA_MS);
    return () => {
      window.clearTimeout(primeira);
      window.clearInterval(intervalo);
    };
  }, [buscar]);

  const instalar = async () => {
    const pacote = atualizacao.current;
    if (!pacote || ocupado) return;
    setSituacao({ tipo: "baixando", versao: pacote.version, baixados: 0 });
    try {
      await pacote.downloadAndInstall((evento) => {
        setSituacao((anterior) =>
          anterior.tipo === "baixando" ? aplicarEventoDownload(anterior, evento) : anterior,
        );
      }, { timeout: 5 * 60_000 });
      // No Windows o instalador normalmente encerra o processo antes daqui.
      // Esta chamada cobre as plataformas em que a instalação retorna.
      await relaunch();
    } catch (erro) {
      setSituacao({ tipo: "erro", mensagem: mensagemDeErro(erro) });
    }
  };

  const adiar = async () => {
    await atualizacao.current?.close().catch(() => undefined);
    atualizacao.current = null;
    setSituacao({ tipo: "repouso" });
  };

  const porcentagem =
    situacao.tipo === "baixando" && situacao.total
      ? Math.min(100, Math.round((situacao.baixados / situacao.total) * 100))
      : undefined;

  return (
    <aside className={`atualizador atualizador--${situacao.tipo}`} aria-live="polite">
      {situacao.tipo === "disponivel" ? (
        <div className="atualizador__oferta">
          <div>
            <strong>SLATE {situacao.versao} está pronto</strong>
            <p>{situacao.notas ?? "Uma nova versão segura está disponível."}</p>
          </div>
          <div className="atualizador__acoes">
            <button className="botao principal" onClick={() => void instalar()}>
              Baixar e atualizar
            </button>
            <button className="botao discreto" onClick={() => void adiar()}>
              Agora não
            </button>
          </div>
        </div>
      ) : situacao.tipo === "baixando" ? (
        <div className="atualizador__progresso">
          <span>Baixando o SLATE {situacao.versao}{porcentagem !== undefined ? ` — ${porcentagem}%` : "…"}</span>
          <progress max={100} value={porcentagem} aria-label="Progresso da atualização" />
          <small>Você pode continuar usando o Agente durante o download.</small>
        </div>
      ) : situacao.tipo === "instalando" ? (
        <p><strong>Atualização verificada.</strong> O SLATE vai fechar, instalar e abrir novamente.</p>
      ) : situacao.tipo === "erro" ? (
        <div className="atualizador__linha">
          <span className="erro">{situacao.mensagem}</span>
          <button className="botao discreto" onClick={() => void buscar(true)}>Tentar de novo</button>
        </div>
      ) : (
        <div className="atualizador__linha">
          <span className="atenuado pequeno">
            {situacao.tipo === "buscando"
              ? "Buscando atualização…"
              : situacao.tipo === "atual"
                ? `SLATE ${situacao.versao} está atualizado.`
                : versaoAtual
                  ? `SLATE ${versaoAtual}`
                  : "SLATE"}
          </span>
          {situacao.tipo !== "buscando" && (
            <button className="botao discreto" onClick={() => void buscar(true)}>
              Buscar atualização
            </button>
          )}
        </div>
      )}
    </aside>
  );
}
