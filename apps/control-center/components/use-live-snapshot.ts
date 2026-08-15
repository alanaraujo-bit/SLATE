"use client";

import { useEffect, useRef, useState } from "react";
import type { Snapshot } from "@/lib/snapshot";

export type LinkState = "live" | "reconnecting" | "offline";

/**
 * Tolerância antes de admitir que a conexão está com problema.
 *
 * O servidor manda um sinal de vida a cada 5s, então este valor precisa cobrir
 * mais de um sinal perdido — senão um engasgo da rede vira alarme. Também não
 * pode ser generoso demais: uma página que afirma estar ao vivo enquanto não
 * recebe nada é pior que uma que admite o problema.
 */
const TOLERANCIA_MS = 12_000;

/** A partir daqui não é mais engasgo: é queda. */
const QUEDA_MS = 30_000;

/** De quanto em quanto tempo o silêncio é reavaliado. */
const INTERVALO_VERIFICACAO_MS = 2_000;

export function useLiveSnapshot(initial: Snapshot) {
  const [snapshot, setSnapshot] = useState(initial);
  const [link, setLink] = useState<LinkState>("live");
  const ultimaMensagem = useRef(Date.now());

  useEffect(() => {
    let fonte: EventSource | null = null;
    let descartado = false;

    /**
     * Estado derivado do silêncio, e só dele.
     *
     * Uma versão anterior também consultava se o socket parecia aberto, e
     * ignorava o silêncio enquanto parecesse. Isso deixava uma faixa em que a
     * página seguia dizendo "ao vivo" sem receber nada há dez segundos — um
     * socket aberto que não entrega é indistinguível de um quebrado para quem
     * está olhando a tela.
     */
    const avaliar = () => {
      const silencio = Date.now() - ultimaMensagem.current;
      if (silencio > QUEDA_MS) setLink("offline");
      else if (silencio > TOLERANCIA_MS) setLink("reconnecting");
      else setLink("live");
    };

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
