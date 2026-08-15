"use client";

import { useEffect, useState } from "react";
import { Indicador } from "@slate/design-system";
import { descrever, type EstadoConexao, type TomEstado } from "@/lib/estados-conexao";

const SITUACAO_POR_TOM: Record<TomEstado, "ok" | "atencao" | "erro" | "neutro"> = {
  positivo: "ok",
  atencao: "atencao",
  erro: "erro",
  neutro: "neutro",
};

/**
 * Mostra o estado da ligação com o computador.
 *
 * Por ora o único estado que a aplicação sabe determinar de verdade é se este
 * aparelho tem rede — o transporte e o pareamento ainda não existem. O
 * componente já trabalha com o vocabulário completo de estados do protocolo,
 * então ligar o resto depois é passar um valor diferente, não reescrever a
 * tela.
 */
export function EstadoDaConexao() {
  const [estado, setEstado] = useState<EstadoConexao>("PAIRING_REQUIRED");

  useEffect(() => {
    const atualizar = () => {
      // Sem rede vence qualquer outra consideração: não adianta falar em
      // pareamento com o aparelho desconectado.
      setEstado(navigator.onLine ? "PAIRING_REQUIRED" : "OFFLINE");
    };

    atualizar();
    window.addEventListener("online", atualizar);
    window.addEventListener("offline", atualizar);

    return () => {
      window.removeEventListener("online", atualizar);
      window.removeEventListener("offline", atualizar);
    };
  }, []);

  const descricao = descrever(estado);

  return (
    <Indicador
      situacao={SITUACAO_POR_TOM[descricao.tom]}
      descricao={descricao.titulo}
      pulsando={descricao.tentandoSozinho}
      title={descricao.explicacao}
      data-estado={estado}
    />
  );
}
