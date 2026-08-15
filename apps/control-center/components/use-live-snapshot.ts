"use client";

import { useEffect, useRef, useState } from "react";
import type { Snapshot } from "@/lib/snapshot";
import { avaliarConexao, type EstadoConexao } from "@/lib/estado-conexao";

export type LinkState = EstadoConexao;

/** De quanto em quanto tempo o silêncio é reavaliado. */
const INTERVALO_VERIFICACAO_MS = 2_000;

export function useLiveSnapshot(initial: Snapshot) {
  const [snapshot, setSnapshot] = useState(initial);
  const [link, setLink] = useState<LinkState>("live");
  const ultimaMensagem = useRef(Date.now());

  useEffect(() => {
    let fonte: EventSource | null = null;
    let descartado = false;

    // A regra vive em `lib/estado-conexao`, onde é verificada nos limites
    // exatos sem depender de navegador.
    const avaliar = () => setLink(avaliarConexao(Date.now() - ultimaMensagem.current));

    const registrarAtividade = () => {
      ultimaMensagem.current = Date.now();
      setLink("live");
    };

    const conectar = () => {
      if (descartado) return;
      fonte = new EventSource("/api/stream");

      fonte.addEventListener("open", registrarAtividade);
      fonte.addEventListener("heartbeat", registrarAtividade);

      fonte.addEventListener("snapshot", (evento) => {
        registrarAtividade();
        try {
          setSnapshot(JSON.parse((evento as MessageEvent<string>).data) as Snapshot);
        } catch {
          /* um quadro malformado não justifica derrubar a página */
        }
      });

      // Fim de fluxo previsto. Reconecta na hora e continua ao vivo — os
      // limites de tempo de função da plataforma não são assunto do operador.
      fonte.addEventListener("rollover", () => {
        ultimaMensagem.current = Date.now();
        fonte?.close();
        if (!descartado) conectar();
      });

      fonte.addEventListener("degraded", () => setLink("reconnecting"));

      // O EventSource tenta reconectar sozinho. Quem decide o que mostrar é a
      // avaliação do silêncio, não o evento de erro em si.
      fonte.addEventListener("error", avaliar);
    };

    conectar();
    const verificacao = setInterval(avaliar, INTERVALO_VERIFICACAO_MS);

    return () => {
      descartado = true;
      clearInterval(verificacao);
      fonte?.close();
    };
  }, []);

  return { snapshot, link };
}
