"use client";

import { useState } from "react";
import { Botao, Rotulo } from "@slate/design-system";
import type { ResultadoExecucaoAcao } from "@/lib/transporte-webrtc";

export function ControlesBasicos({
  executar,
}: {
  executar: (actionId: string) => Promise<ResultadoExecucaoAcao>;
}) {
  const [executando, setExecutando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoExecucaoAcao | null>(null);

  const reproduzirPausar = async () => {
    if (executando) return;
    setExecutando(true);
    setResultado(null);
    try {
      setResultado(await executar("midia.reproduzir-pausar"));
    } finally {
      setExecutando(false);
    }
  };

  return (
    <section className="controles-basicos" aria-label="Controles do computador">
      <div>
        <h2>Mídia</h2>
        <Rotulo tamanho="xs" tom="sutil">
          Funciona com o aplicativo de mídia ativo no Windows.
        </Rotulo>
      </div>
      <Botao
        tom="acento"
        tamanho="lg"
        estado={executando ? "loading" : "idle"}
        onClick={() => void reproduzirPausar()}
      >
        Reproduzir / pausar
      </Botao>
      {resultado && (
        <p
          className={
            resultado.ok
              ? "controle-resultado controle-resultado--ok"
              : "controle-resultado controle-resultado--erro"
          }
          role={resultado.ok ? "status" : "alert"}
        >
          {resultado.mensagem}
        </p>
      )}
    </section>
  );
}
